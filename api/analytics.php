<?php

declare(strict_types=1);

/**
 * "A player just did something." The second public write in the API.
 * Spec: docs/specs/analytics.md §3 · docs/database.md §3
 *
 * Browsers call this directly, so — unlike `api/played.php`, whose one caller is a
 * Durable Object holding a shared secret — there is **no token to check**. A secret
 * shipped to every browser is not a secret, and pretending otherwise would be worse than
 * being honest about it: this endpoint is open by design, and the design has to survive
 * that.
 *
 * ## What bounds the damage
 *
 * - **The action is an allowlist** (`Analytics::ACTIONS`), so nothing here can invent a
 *   kind of event, and `object` must be a slug.
 * - **Every string is capped** at its column width, so no request can be large by being
 *   verbose.
 * - **A per-visitor rate limit** (`Analytics::throttled`) keeps a stuck loop or an idle
 *   curl from filling a shared-hosting database. Anyone can drop the cookie and get a
 *   fresh budget; the point is to bound accidents, not to stop a determined abuser, and
 *   claiming otherwise in a comment would be the sort of security theatre that gets
 *   trusted later.
 *
 * ## What it never does
 *
 * **Store the caller's IP.** It is read from the headers, handed to the geolocator, and
 * dropped; `city` and `country` are the only trace. There is no column for it, which is
 * the version of this promise that survives somebody editing this file.
 *
 * It answers 204 with no body. Nothing on the client reads the response — the beacon is
 * fire-and-forget — so a body would be bytes spent on nobody, and a 204 makes "this
 * worked" unambiguous in a network panel.
 */

require_once __DIR__ . '/lib/App.php';
require_once __DIR__ . '/lib/Analytics.php';

/** No body, ever. The status IS the answer. */
function done(int $status): never
{
    http_response_code($status);
    header('Cache-Control: no-store');
    exit;
}

/*
 * An uncaught throwable would be an empty 500 with display_errors off. Nothing is
 * watching this endpoint, so it fails quietly and on purpose: analytics must never be
 * the reason a player sees something break, and there is no user-facing consequence to
 * a lost event.
 */
set_exception_handler(static function (Throwable $e): void {
    done(500);
});

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    done(405);
}

$app = App::boot(__DIR__);

if (!$app->configured()) {
    // No database on this host. Not an error the caller can act on, and not worth a
    // retry — 204, the same as success, so a half-configured host does not fill a
    // console with red.
    done(204);
}

if (!$app->analyticsEnabled()) {
    // The operator's off switch (docs/specs/analytics.md §5). Same silent 204: turning
    // collection off should look, from the browser, exactly like it working.
    done(204);
}

$raw = file_get_contents('php://input');
// Cap what is parsed at all. A valid event is a couple of hundred bytes; anything past
// this is not one, and json_decode on a megabyte of nonsense is work done for an
// attacker.
if ($raw === false || strlen($raw) > 2048) {
    done(400);
}

$decoded = $raw === '' ? null : json_decode($raw, true);
$parsed = Analytics::parse(is_array($decoded) ? $decoded : null);

if ($parsed['ok'] !== true) {
    done(400);
}

$visitor = Analytics::visitor(
    isset($_COOKIE[Analytics::COOKIE]) && is_string($_COOKIE[Analytics::COOKIE])
        ? $_COOKIE[Analytics::COOKIE]
        : null,
);

/*
 * Set before anything can fail, so a visitor whose first event is throttled or errors
 * still gets a stable id rather than a fresh one on every request — which would both
 * defeat the rate limit and make one person look like a crowd.
 *
 * `httponly`: the id is for counting, and script has no reason to read it. `samesite`
 * Lax rather than Strict so it survives arriving on a shared link, which is how most
 * players get here in the first place.
 */
if ($visitor['fresh']) {
    setcookie(Analytics::COOKIE, $visitor['id'], [
        'expires' => time() + Analytics::COOKIE_TTL_S,
        'path' => '/',
        'secure' => ($_SERVER['HTTPS'] ?? '') !== '' || ($_SERVER['REQUEST_SCHEME'] ?? '') === 'https',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

$analytics = $app->analytics();

try {
    if ($analytics->throttled($visitor['id'])) {
        // 429 rather than a silent 204: this one IS worth seeing in a network panel,
        // because a client hitting it means a bug in the client.
        done(429);
    }

    $analytics->record(
        $visitor['id'],
        $parsed['action'],
        $parsed['object'],
        $parsed['referrer'],
        $parsed['nickname'],
        Analytics::callerIp($_SERVER),
    );
} catch (PDOException $e) {
    // The schema is not installed, or MySQL is down. Neither is the caller's problem and
    // neither is worth a retry storm from every phone in the room.
    done(204);
}

done(204);
