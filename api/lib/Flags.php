<?php

declare(strict_types=1);

/**
 * Feature flags: what PHP is allowed to store, and how it gets published.
 * Spec: docs/specs/backoffice.md §2b · docs/specs/seo.md §4
 *
 * ## This file deliberately contains no *decisions*
 *
 * Whether a card shows, whether it is playable, whether a room may open — all of
 * that lives in `shared/flags.ts` (`cardState`, `mayOpenRoom`, `flagFor`), in
 * TypeScript, covered by the Node harness. **PHP re-implements none of it**, because
 * two copies of a rule is one copy too many and the second one drifts silently.
 *
 * What is here is storage hygiene: sanitising a slug, normalising a patch, and
 * writing the file everything reads. Sanitising is not a decision — it is the same
 * guard `worker/router.ts` applies, and it has to be applied on the writing side too
 * because this string ends up in a URL.
 */
final class Flags
{
    public const ACTIVE = 'active';
    public const DISABLED = 'disabled';
    public const HIDDEN = 'hidden';

    /** Matches `FlagState` in shared/flags.ts. */
    public const STATES = [self::ACTIVE, self::DISABLED, self::HIDDEN];

    /** Same cap the Worker's `/admin/flags` route used. A reason is a note, not prose. */
    public const REASON_MAX = 120;

    /**
     * A game slug, sanitised — or null.
     *
     * **Byte-identical to `gameSlug()` in `worker/router.ts`**: `^[a-z][a-z0-9-]{0,31}$`.
     * Kept in step by hand, and by `flags_test.php` asserting the same table of
     * inputs that `worker/router.test.ts` asserts. The rule exists because a slug is
     * handed to the hub, which turns it into a URL — this is what stops `../`,
     * `//host` or a full URL becoming an open redirect.
     *
     * PCRE needs the anchors *and* `D`: without `/D`, `$` also matches before a
     * trailing newline, so `"tap-duel\n"` would pass. That is the whole trap.
     */
    public static function slug(?string $raw): ?string
    {
        if ($raw === null || $raw === '') {
            return null;
        }

        return preg_match('/^[a-z][a-z0-9-]{0,31}$/D', $raw) === 1 ? $raw : null;
    }

    /** The shape a slug gets when nothing has ever been set for it. */
    public static function default(): array
    {
        return ['availability' => self::ACTIVE, 'isNew' => false];
    }

    /**
     * Apply an operator's patch to one slug's flag, returning the whole new map.
     *
     * A patch is partial on purpose: the admin page toggles availability without
     * having to restate `isNew`, and vice versa. Unknown keys and wrong types are
     * dropped rather than rejected — the caller is a form, and a form that silently
     * sends `isNew: "true"` should not 500.
     *
     * `reason` is **absent, never empty**, matching `GameFlag` in shared/flags.ts
     * where the field is `reason?: string`. An empty string would render as a blank
     * badge.
     *
     * @param array<string, array<string, mixed>> $flags
     * @param array<string, mixed> $patch
     * @return array<string, array<string, mixed>>
     */
    public static function apply(array $flags, string $slug, array $patch): array
    {
        $current = $flags[$slug] ?? self::default();

        if (isset($patch['availability']) && in_array($patch['availability'], self::STATES, true)) {
            $current['availability'] = $patch['availability'];
        }

        if (isset($patch['isNew']) && is_bool($patch['isNew'])) {
            $current['isNew'] = $patch['isNew'];
        }

        if (array_key_exists('reason', $patch)) {
            $reason = $patch['reason'];
            if (is_string($reason)) {
                // Trimmed first: a reason of "   " is nothing, and would otherwise
                // print as a badge made of spaces.
                $reason = trim($reason);
                $reason = mb_substr($reason, 0, self::REASON_MAX);
                if ($reason === '') {
                    unset($current['reason']);
                } else {
                    $current['reason'] = $reason;
                }
            } elseif ($reason === null) {
                unset($current['reason']);
            }
        }

        $flags[$slug] = $current;
        ksort($flags);

        return $flags;
    }

    /**
     * The JSON everything reads. Matches `PublicFlags` in shared/flags.ts.
     *
     * **Just the flags — no audit trail, no hint that an admin exists.** This file is
     * public: the Worker fetches it over HTTPS and the hub is rendered from it, so
     * anything in it is world-readable. Who changed what and when stays in MySQL.
     *
     * @param array<string, array<string, mixed>> $flags
     */
    public static function encode(array $flags): string
    {
        // An empty map must encode as `{}`, not `[]`. PHP's empty array is
        // ambiguous and json_encode picks the list form, which would make
        // `flags.flags[slug]` a runtime error on the reading side for the one case
        // that happens on a fresh install.
        $payload = ['flags' => $flags === [] ? new stdClass() : $flags];

        return json_encode(
            $payload,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        );
    }

    /**
     * Write `flags.json` **atomically**.
     *
     * A plain `file_put_contents` is not good enough here and the reason is concrete:
     * the Worker fetches this file on room-open and `index.php` reads it on every
     * page view, so a write races live readers. Truncate-then-write leaves a window
     * where a reader sees half a document, fails to parse it, and fails open —
     * meaning a *disabled* game becomes playable for the duration of a write.
     *
     * Write to a temp file in the same directory and `rename()` over the target:
     * rename is atomic within a filesystem, so a reader sees either the old file or
     * the new one and never a partial one. Same directory matters — across
     * filesystems `rename` degrades to copy-then-delete and the atomicity is gone.
     *
     * Returns false rather than throwing: the caller is an admin write that has
     * already succeeded in MySQL, and it needs to report "saved, but not published"
     * rather than lose the save.
     */
    public static function publish(string $path, string $json): bool
    {
        $dir = dirname($path);
        $tmp = tempnam($dir, '.flags');
        if ($tmp === false) {
            return false;
        }

        if (file_put_contents($tmp, $json) !== strlen($json)) {
            @unlink($tmp);

            return false;
        }

        // tempnam() creates the file 0600, which the web server can then not read
        // once it is renamed into place. Set it before the rename, not after, so
        // there is no instant where the published file is unreadable.
        @chmod($tmp, 0644);

        if (!rename($tmp, $path)) {
            @unlink($tmp);

            return false;
        }

        return true;
    }

    /**
     * Read the published file, for the page renderer.
     *
     * **Anything wrong ⇒ an empty map**, which every reader treats as "all games
     * active" (shared/flags.ts). Fail open is the documented rule, and the
     * consequence is stated there rather than discovered: a flag is not a security
     * control. A missing file is the normal state of a fresh install, not an error.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function read(string $path): array
    {
        if (!is_readable($path)) {
            return [];
        }

        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || !isset($decoded['flags']) || !is_array($decoded['flags'])) {
            return [];
        }

        // Re-sanitise on the way in. The file is on disk and could have been edited
        // by hand, and a bad slug from here would reach a URL just as easily as one
        // from a form.
        $out = [];
        foreach ($decoded['flags'] as $slug => $flag) {
            if (!is_string($slug) || self::slug($slug) === null || !is_array($flag)) {
                continue;
            }

            $availability = $flag['availability'] ?? self::ACTIVE;
            $clean = [
                'availability' => in_array($availability, self::STATES, true)
                    ? $availability
                    : self::ACTIVE,
                'isNew' => ($flag['isNew'] ?? false) === true,
            ];

            if (isset($flag['reason']) && is_string($flag['reason']) && trim($flag['reason']) !== '') {
                $clean['reason'] = mb_substr(trim($flag['reason']), 0, self::REASON_MAX);
            }

            $out[$slug] = $clean;
        }

        ksort($out);

        return $out;
    }
}
