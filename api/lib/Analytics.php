<?php

declare(strict_types=1);

require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/Flags.php';

/**
 * Geolocation, behind an interface — so the tests never touch the network.
 *
 * Same reasoning as `Mailer` and `Clock`: the rule worth testing is "a failed lookup
 * stores NULL rather than throwing", and a test that has to reach ipinfo.io to prove it
 * is a test that fails when someone's wifi does.
 */
interface Geolocator
{
    /**
     * City and country for an address, or nulls when it cannot be known.
     *
     * Never throws. A caller mid-insert has nothing useful to do with an exception from
     * a service that is only supplying two nice-to-have columns.
     *
     * @return array{city: ?string, country: ?string}
     */
    public function locate(string $ip): array;
}

/** What an unconfigured host gets: no token, no calls, no columns. */
final class NoGeolocator implements Geolocator
{
    public function locate(string $ip): array
    {
        return ['city' => null, 'country' => null];
    }
}

/**
 * ipinfo.io.
 *
 * Called inline, once per event, with a short timeout. There is deliberately no cache
 * table: this is a party-game site whose traffic is measured in rounds per evening, the
 * free tier is 50k lookups a month, and a cache keyed by anything useful would have to
 * key on the address — the one value this whole design exists to avoid keeping. If the
 * quota ever bites, the answer is a cache keyed by a HASH of the address with a short
 * TTL, and that is a change to this class alone.
 */
final class IpInfoGeolocator implements Geolocator
{
    /**
     * Short on purpose. The client fires these off and never waits for the answer, so a
     * slow lookup costs nobody a frame — but it does hold a PHP worker, and on shared
     * hosting those are the scarce thing.
     */
    private const TIMEOUT_S = 2;

    public function __construct(private string $token)
    {
    }

    public function locate(string $ip): array
    {
        $none = ['city' => null, 'country' => null];

        if ($this->token === '' || !self::routable($ip)) {
            return $none;
        }

        $handle = curl_init('https://ipinfo.io/' . urlencode($ip) . '/json');
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_S,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $this->token, 'Accept: application/json'],
        ]);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);

        if ($body === false || $status !== 200) {
            return $none;
        }

        $decoded = json_decode((string) $body, true);
        if (!is_array($decoded)) {
            return $none;
        }

        return [
            'city' => Analytics::text($decoded['city'] ?? null, 100),
            // `country` is alpha-2 from ipinfo. Anything else is not a country code, and
            // a CHAR(2) column would silently truncate it into a wrong one.
            'country' => is_string($decoded['country'] ?? null)
                && preg_match('/^[A-Za-z]{2}$/D', $decoded['country']) === 1
                ? strtoupper($decoded['country'])
                : null,
        ];
    }

    /**
     * Is this an address worth asking about?
     *
     * A private or loopback address geolocates to nothing, so the call is a wasted
     * round trip and a wasted lookup off the quota. This is also what makes local
     * development quiet rather than spamming ipinfo with 127.0.0.1.
     */
    private static function routable(string $ip): bool
    {
        return filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE,
        ) !== false;
    }
}

/**
 * Recording what players did, without recording who they are.
 * Spec: docs/specs/analytics.md §3
 *
 * Everything that decides anything lives here rather than in `api/analytics.php`, which
 * is a public endpoint and therefore the last place complicated code should be. The
 * endpoint reads the request; this validates it and writes the row.
 *
 * ## The one rule that matters
 *
 * **The IP address is never stored.** It arrives, it is handed to a `Geolocator`, and it
 * goes out of scope. `city` and `country` are all that survive, which is why they are
 * resolved on the way IN rather than kept as an address to resolve later — a column of
 * addresses "to be geolocated in the reporting query" is the same data with a longer
 * fuse.
 */
final class Analytics
{
    /**
     * The allowlist. An action not in here is a 400, not a row.
     *
     * A controlled vocabulary in code rather than an ENUM in the schema, for the reason
     * `db/init.sql` gives about `games.availability`: a seventh action should be a
     * one-line change here, not a migration.
     */
    public const ACTIONS = [
        'hub_nav',
        'game_select',
        'room_create',
        'room_join',
        'game_start',
        'game_played',
    ];

    /** The cookie the visitor id lives in. */
    public const COOKIE = 'fony_vid';

    /** A year. Long enough for "returning visitor" to mean anything at all. */
    public const COOKIE_TTL_S = 31_536_000;

    /**
     * The per-visitor ceiling, and the window it applies over.
     *
     * Not a security control — anyone can drop the cookie and get a fresh budget. It is
     * there so a stuck loop in a game, or somebody idly curling the endpoint, cannot
     * turn a shared-hosting MySQL into a landfill overnight. A real round produces a
     * handful of events, so this is orders of magnitude above normal play.
     */
    public const RATE_LIMIT = 60;
    public const RATE_WINDOW_MS = 60_000;

    public function __construct(
        private PDO $pdo,
        private Clock $clock,
        private Geolocator $geo,
    ) {
    }

    /**
     * Trim a value to fit its column, or null.
     *
     * Truncating rather than rejecting: a long referrer is not an error, and the
     * alternative is losing the whole event over a query string. `mb_substr`, because
     * cutting a UTF-8 nickname mid-codepoint produces bytes MySQL rejects on a utf8mb4
     * column — which would turn a long name into a 500.
     */
    public static function text(mixed $raw, int $limit): ?string
    {
        if (!is_string($raw)) {
            return null;
        }

        $clean = trim(preg_replace('/\s+/', ' ', $raw) ?? '');
        if ($clean === '') {
            return null;
        }

        return mb_substr($clean, 0, $limit);
    }

    /** Is this one of the six actions the client is allowed to report? */
    public static function action(mixed $raw): ?string
    {
        return is_string($raw) && in_array($raw, self::ACTIONS, true) ? $raw : null;
    }

    /**
     * A visitor id, minted if the browser did not present a usable one.
     *
     * Shaped as well as present: the cookie is attacker-controlled, and a CHAR(36)
     * column plus a rate limit keyed on this value are both reasons not to take
     * whatever arrives. Anything that is not a v4 UUID is replaced rather than
     * rejected, so a mangled cookie costs the visitor their history and nothing else.
     *
     * @return array{id: string, fresh: bool}
     */
    public static function visitor(?string $presented): array
    {
        if ($presented !== null && preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D', $presented) === 1) {
            return ['id' => $presented, 'fresh' => false];
        }

        return ['id' => self::uuid4(), 'fresh' => true];
    }

    /** A v4 UUID from a cryptographic source — `mt_rand` would be predictable across visitors. */
    public static function uuid4(): string
    {
        $bytes = random_bytes(16);
        // Version 4, variant 1: the two fixed nibble groups a v4 UUID must carry.
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    /**
     * Has this visitor already used up their budget for the current window?
     *
     * Reads the events table rather than keeping a table of its own: the index
     * `idx_analytics_visitor_at` makes it one range scan, and a second table would be
     * more schema to keep in step for a guard this cheap.
     */
    public function throttled(string $visitorId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT COUNT(*) FROM analytics_event WHERE visitor_id = ? AND at >= ?',
        );
        $statement->execute([$visitorId, $this->clock->now() - self::RATE_WINDOW_MS]);

        return (int) $statement->fetchColumn() >= self::RATE_LIMIT;
    }

    /**
     * Write one event.
     *
     * `$ip` is used and dropped — it is a parameter, never a column. The timestamp comes
     * from the clock rather than the request for the obvious reason: a client can claim
     * any time it likes, and half of them have a wrong one honestly.
     *
     * @return array{at: int, city: ?string, country: ?string}
     */
    public function record(
        string $visitorId,
        string $action,
        ?string $object,
        ?string $referrer,
        ?string $nickname,
        string $ip,
    ): array {
        $located = $this->geo->locate($ip);
        $at = $this->clock->now();

        $this->pdo->prepare(
            'INSERT INTO analytics_event (at, visitor_id, city, country, referrer, nickname, action, object)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )->execute([
            $at,
            $visitorId,
            $located['city'],
            $located['country'],
            $referrer,
            $nickname,
            $action,
            $object,
        ]);

        return ['at' => $at, 'city' => $located['city'], 'country' => $located['country']];
    }

    /**
     * The caller's address, from the headers a reverse proxy in front of PHP sets.
     *
     * `REMOTE_ADDR` last, and every candidate validated as an IP: these headers are
     * client-supplied unless something trusted overwrites them, so this is a hint about
     * geography, not an identity — which is precisely all it is used for. The FIRST
     * entry of `X-Forwarded-For` is the original client; the rest are proxies.
     *
     * @param array<string, mixed> $server
     */
    public static function callerIp(array $server): string
    {
        foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $key) {
            $value = $server[$key] ?? null;
            if (!is_string($value) || $value === '') {
                continue;
            }
            $first = trim(explode(',', $value)[0]);
            if (filter_var($first, FILTER_VALIDATE_IP) !== false) {
                return $first;
            }
        }

        return '';
    }

    /**
     * Validate a whole request body into the row it would become, or say what is wrong.
     *
     * One function so the endpoint has no branches worth testing of its own, and so the
     * tests can assert the rules without speaking HTTP.
     *
     * @param array<string, mixed>|null $body
     * @return array{ok: true, action: string, object: ?string, referrer: ?string, nickname: ?string}
     *   |array{ok: false, error: string}
     */
    public static function parse(?array $body): array
    {
        $action = self::action($body['action'] ?? null);
        if ($action === null) {
            return ['ok' => false, 'error' => 'unknown action'];
        }

        /*
         * `object` is a slug or nothing. Reusing `Flags::slug()` rather than a fresh
         * regex keeps one definition of what a slug is — the same one the router and the
         * flags table enforce. An `object` that is present but malformed is refused
         * rather than nulled: it means the caller and this endpoint disagree, and
         * silently recording a different event than the one that happened is worse than
         * recording none.
         */
        $rawObject = $body['object'] ?? null;
        $object = null;
        if ($rawObject !== null && $rawObject !== '') {
            $object = Flags::slug(is_string($rawObject) ? $rawObject : null);
            if ($object === null) {
                return ['ok' => false, 'error' => 'bad object'];
            }
        }

        return [
            'ok' => true,
            'action' => $action,
            'object' => $object,
            'referrer' => self::text($body['referrer'] ?? null, 255),
            'nickname' => self::text($body['nickname'] ?? null, 20),
        ];
    }
}
