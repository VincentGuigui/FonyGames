<?php

declare(strict_types=1);

require_once __DIR__ . '/AuthStore.php';
require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/Mailer.php';

/**
 * The magic link: request it, redeem it, and the break-glass token.
 * Spec: docs/specs/backoffice.md §4
 *
 * ## Everything here closes a specific hole
 *
 * The happy path is four lines. The rest of this file is the holes, each named where it
 * is closed, because every one of them is invisible in a browser:
 *
 * - **The response never varies.** Wrong address, rate limited, or sent — the caller
 *   gets the same answer, so the endpoint cannot be used to find out who the operator
 *   is.
 * - **The rate limit is checked BEFORE the address.** Otherwise a rate-limited reply
 *   means "you guessed right, come back later", and the limit becomes the oracle the
 *   identical responses exist to prevent.
 * - **The token is compared through a hash**, so neither its value nor its length
 *   leaks through timing.
 * - **Only the hash is stored.** A database dump contains nothing redeemable.
 * - **Single use, ten minutes, one outstanding at a time.**
 * - **An unset address matches nobody.** Not "matches everybody", which is what a
 *   `== ''` comparison would quietly do on a half-configured host.
 *
 * ## What is no longer here, and why that is the point
 *
 * The Worker version of this file also hand-rolled HMAC session tokens, their
 * signature check and their expiry parsing. Those are gone: sessions are
 * `session_start()` with an `HttpOnly` cookie, same-origin, so there is no signature to
 * forge and no expiry string to extend. The holes did not get tested — they stopped
 * existing.
 */
final class Auth
{
    /** A link is worth ten minutes. Long enough to walk to a laptop. */
    public const LINK_TTL_MS = 600_000;

    /** How many link requests one caller gets per window. */
    public const LINK_MAX = 5;
    public const LINK_WINDOW_MS = 3_600_000;

    public function __construct(
        private AuthStore $store,
        private Clock $clock,
        private Mailer $mailer,
        /** The one address a link may go to. Empty means "no admin". */
        private string $adminEmail,
        /** Break-glass bearer. Empty means "no break-glass", never "anything works". */
        private string $adminToken,
        /** Where the link points, e.g. `https://fonygames.guigui.fr/ops-x/`. */
        private string $linkBase,
    ) {
    }

    /**
     * Ask for a link.
     *
     * **Returns nothing on purpose.** The endpoint answers `204` whatever happened, and
     * a return value would be a temptation to branch on it. The only thing the caller
     * may know is whether the *mailer itself* broke, which is a fault on our side and
     * surfaces as a 502 — so that one case throws.
     *
     * @throws RuntimeException when the mailer refuses a mail we did want to send.
     */
    public function requestLink(string $email, string $clientIp): void
    {
        $now = $this->clock->now();
        $ipHash = $this->ipHash($clientIp);

        // Housekeeping first, and cheap: without it the attempts table grows forever.
        $this->store->pruneAttempts($now - self::LINK_WINDOW_MS);

        // ── The order of these two blocks is the security property ──
        // Rate limit, THEN address. Reversed, a wrong address would never be counted,
        // so an attacker could tell a right address from a wrong one by whether they
        // eventually got rate limited. Counting every attempt — including the wrong
        // ones — is what makes the two indistinguishable.
        $this->store->recordAttempt($ipHash, $now);
        if ($this->store->countAttempts($ipHash, $now - self::LINK_WINDOW_MS) > self::LINK_MAX) {
            return;
        }

        if (!$this->isAdminAddress($email)) {
            return;
        }

        $token = bin2hex(random_bytes(32));
        $this->store->saveLink(hash('sha256', $token), $now + self::LINK_TTL_MS);

        // The token rides in the **fragment**, never the query string. A fragment is
        // not sent to a server, so it cannot land in an access log, a Referer header,
        // or a proxy's history. The page reads it from `location.hash` and posts it.
        $link = rtrim($this->linkBase, '/') . '/#' . $token;

        $sent = $this->mailer->send(
            $email,
            'FonyGames admin link',
            "Sign in to the FonyGames admin centre:\n\n{$link}\n\n"
            . "The link works once and expires in 10 minutes.\n"
            . "If you did not ask for this, someone knows the admin URL — nothing is\n"
            . "exposed, but say so.\n",
        );

        if (!$sent) {
            // Loud, because the alternative is an operator staring at a link that
            // never arrives with no way to tell a broken mailer from a spam folder.
            throw new RuntimeException('the mailer refused the message');
        }
    }

    /**
     * Redeem a token. True means "start a session".
     *
     * **The link is deleted only on a match.** Deleting on every attempt would let
     * anyone who knows the admin URL burn the operator's outstanding link by posting
     * junk — a denial of service for free. The token is 32 random bytes, so leaving it
     * alive through a wrong guess costs nothing.
     */
    public function redeem(string $token): bool
    {
        $link = $this->store->link();
        if ($link === null || $token === '') {
            return false;
        }

        // Expiry before comparison, and the expired link is cleared: a stale row would
        // otherwise sit there until the next request replaced it.
        if ($this->clock->now() > $link['expiresAt']) {
            $this->store->deleteLink();

            return false;
        }

        if (!hash_equals($link['hash'], hash('sha256', $token))) {
            return false;
        }

        $this->store->deleteLink();

        return true;
    }

    /**
     * The break-glass bearer, for `curl` when the mailbox is broken.
     *
     * Kept because shared-host mail is unpredictable and a dead mailbox must not lock
     * the operator out of their own flags (spec §5).
     */
    public function authorisedByToken(?string $header): bool
    {
        return self::tokenMatches(self::tokenFromHeader($header), $this->adminToken);
    }

    /**
     * The token the request presented, from wherever this host chose to put it.
     *
     * **`Authorization` is not reliably visible to PHP.** Apache consumes it for its own
     * auth and, with a CGI/FastCGI/FPM handler, does not forward it unless `CGIPassAuth`
     * is on — so on a shared host `$_SERVER['HTTP_AUTHORIZATION']` can simply be absent
     * while the client did send it. That looks exactly like a wrong token.
     *
     * The fix is not an `.htaccess` rewrite: `RewriteEngine On` where `AllowOverride`
     * forbids `FileInfo` is a **500 for the whole directory**, so guessing there would risk
     * taking the API down to fix a header. `X-Admin-Token` needs no server cooperation —
     * every SAPI forwards an ordinary custom header — and over HTTPS it is exactly as
     * private as the one Apache eats.
     *
     * Order is deliberate: the standard header first, its mod_rewrite alias second, the
     * custom one last, so a host that behaves normally behaves normally.
     *
     * @param array<string, mixed> $server
     */
    public static function presentedToken(array $server): ?string
    {
        foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
            $found = self::tokenFromHeader(is_string($server[$key] ?? null) ? $server[$key] : null);
            if ($found !== null) {
                return $found;
            }
        }

        $custom = $server['HTTP_X_ADMIN_TOKEN'] ?? null;

        return is_string($custom) && $custom !== '' ? $custom : null;
    }

    /** `Bearer <token>` → `<token>`. Null for anything else, including a bare token. */
    public static function tokenFromHeader(?string $header): ?string
    {
        if ($header === null || !str_starts_with($header, 'Bearer ')) {
            return null;
        }

        $token = substr($header, 7);

        return $token === '' ? null : $token;
    }

    /**
     * The comparison, without an Auth instance — and therefore **without a database**.
     *
     * Constructing an Auth opens the connection (`App::auth()` builds a PdoAuthStore), so
     * an unreachable database used to throw before the token had been looked at. Every
     * action then answered 500 before dispatch, which is what hid the cause of a failed
     * deploy behind an empty body. `App::tokenMatches()` calls this to settle authorisation
     * first, so the failure that follows can name itself.
     *
     * Static rather than duplicated: a constant-time comparison is not a thing to have two
     * copies of.
     */
    public static function tokenMatches(?string $presented, string $expected): bool
    {
        if ($expected === '' || $presented === null) {
            return false;
        }

        // Both sides hashed, for the reason `constantTimeEquals` documents: bare
        // `hash_equals` returns false immediately on a length mismatch, so the token's
        // length is observable through timing. This is the same comparison, not a cheaper
        // one — it is static only so it can run before the database is touched.
        return hash_equals(hash('sha256', $expected), hash('sha256', $presented));
    }

    /**
     * Is this the operator's address?
     *
     * Case-insensitive and trimmed, because a mail address typed on a phone arrives
     * capitalised and padded — and a link the operator cannot request is not security,
     * it is a bug. The local part is technically case-sensitive per RFC 5321; no real
     * provider treats it that way, and there is exactly one address here.
     */
    private function isAdminAddress(string $email): bool
    {
        if ($this->adminEmail === '') {
            // Unset matches NOBODY. The trap being avoided is a `==` against an empty
            // configured value, which on a half-configured host would mail a link to
            // anyone who posted an empty address.
            return false;
        }

        return $this->constantTimeEquals(
            strtolower(trim($email)),
            strtolower(trim($this->adminEmail)),
        );
    }

    /**
     * Compare two secrets without leaking their length.
     *
     * `hash_equals` alone returns false immediately when the lengths differ, so the
     * length is observable through timing. Hashing both sides first makes every
     * comparison the same 64 bytes. Cheap, and it removes a whole class of question.
     */
    private function constantTimeEquals(string $a, string $b): bool
    {
        return hash_equals(hash('sha256', $a), hash('sha256', $b));
    }

    /**
     * The rate-limit key.
     *
     * Hashed, so the attempts table holds no IP addresses. §1's privacy boundary is
     * about players rather than the operator, but a table of raw addresses is a thing
     * to explain and a hash costs one call.
     */
    private function ipHash(string $ip): string
    {
        return hash('sha256', $ip);
    }
}
