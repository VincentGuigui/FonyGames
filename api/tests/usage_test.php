<?php

declare(strict_types=1);

// Explicit, even though an alphabetically-earlier test file already loads it: run.php
// discovers files by glob and sorts them, so relying on that order means this file breaks
// the day it is renamed.
require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/Health.php';
require_once __DIR__ . '/../lib/Usage.php';

/**
 * The health and usage panels.
 * Spec: docs/specs/backoffice.md §2
 *
 * Almost everything here is a failure case, and deliberately. The panel's job is to be
 * looked at when something is wrong, so the states that matter are the broken ones — and
 * the one thing it must never do is show a confident number it does not have. A row of
 * zeroes against the free-tier ceiling would read as "plenty of headroom" on the day the
 * analytics token expired.
 *
 * ⚠️ Every response body below is **hand-written from the documented schema**, not
 * recorded from Cloudflare: this sandbox cannot reach `api.cloudflare.com` and the
 * analytics token does not exist yet. So these tests prove the parser handles the shape it
 * was told to expect and degrades honestly on anything else. They do **not** prove the
 * shape is right. That is stated in `Usage`'s own docblock too, because it is the kind of
 * caveat that goes missing.
 */

group('usage: nothing configured is not an error');

$blank = new Usage('', '', static fn () => ['status' => 500, 'body' => 'should not be called']);
$result = $blank->daily();
check('it reports unavailable', $result['ok'] === false);
check('and says why, in words', str_contains((string) $result['reason'], 'no analytics token'), $result['reason']);
check('the ceilings are still reported', $result['ceilings']['requests'] === Usage::REQUESTS_PER_DAY);
// The panel needs the ceiling even when it has no usage, or it cannot render the scale it
// is measuring against.
check('including the GB-second ceiling', $result['ceilings']['gbSeconds'] === Usage::GB_SECONDS_PER_DAY);

group('usage: a good response');

$good = json_encode([
    'data' => ['viewer' => ['accounts' => [[
        'durableObjectsInvocationsAdaptiveGroups' => [
            ['dimensions' => ['date' => '2026-08-05'], 'sum' => ['requests' => 4200]],
            ['dimensions' => ['date' => '2026-08-06'], 'sum' => ['requests' => 9100]],
        ],
        'durableObjectsPeriodicGroups' => [
            ['dimensions' => ['date' => '2026-08-06'], 'sum' => ['requests' => 12]],
        ],
    ]]]],
]);

$parsed = Usage::parse((string) $good);
check('it parses', $parsed['ok'] === true, $parsed);
check('two days', count($parsed['days']) === 2, $parsed['days']);
// Newest first: the operator wants today, and a panel that buries it under a week of
// history is a panel nobody reads twice.
check('newest first', $parsed['days'][0]['date'] === '2026-08-06', $parsed['days']);
check('with its request count', $parsed['days'][0]['requests'] === 9100);
check('and yesterday behind it', $parsed['days'][1]['requests'] === 4200);
// The query deliberately does not ask for GB-seconds — one unknown field name would fail
// the whole query and take the request count with it (see Usage::QUERY).
check('GB-seconds is honestly unknown, not zero', $parsed['days'][0]['gbSeconds'] === null, $parsed['days'][0]);

group('usage: every way it can go wrong');

$cases = [
    'not JSON at all' => ['<html>502 Bad Gateway</html>', 'not JSON'],
    'a GraphQL error with HTTP 200' => [
        '{"data":null,"errors":[{"message":"Authentication error"}]}',
        'Authentication error',
    ],
    'the wrong account' => ['{"data":{"viewer":{"accounts":[]}}}', 'no account'],
    'an empty result set' => [
        '{"data":{"viewer":{"accounts":[{"durableObjectsInvocationsAdaptiveGroups":[]}]}}}',
        'no usage rows',
    ],
];

foreach ($cases as $label => [$body, $expected]) {
    $r = Usage::parse($body);
    check("{$label} reports unavailable", $r['ok'] === false, $r);
    check("{$label} explains itself", str_contains((string) $r['reason'], $expected), $r['reason'] ?? null);
    // The raw body is the only way an operator can fix a schema change themselves.
    check("{$label} keeps the raw body to look at", isset($r['raw']) && $r['raw'] !== '');
}

// GraphQL answers its own errors with HTTP 200, so treating 200 as success is the specific
// trap here — it would report an auth failure as "0 requests today".
$r = Usage::parse('{"data":null,"errors":[{"message":"Authentication error"}]}');
check('a 200 with GraphQL errors is NOT success', $r['ok'] === false);
check('and does not invent a days array', !isset($r['days']), $r);

group('usage: a non-200 never reaches the parser');

$http500 = new Usage('acct', 'tok', static fn () => ['status' => 500, 'body' => 'nope']);
$r = $http500->daily();
check('a 500 is reported with its status', str_contains((string) $r['reason'], '500'), $r['reason']);

$dead = new Usage('acct', 'tok', static fn () => ['status' => 0, 'body' => 'Could not resolve host']);
$r = $dead->daily();
// Status 0 is not an HTTP code; it is what a DNS or TLS failure looks like, and the panel
// has to say something rather than claim Cloudflare answered.
check('a failed request is reported as one', str_contains((string) $r['reason'], '0'), $r['reason']);
check('with the transport error attached', str_contains((string) $r['raw'], 'resolve host'), $r['raw'] ?? null);

group('usage: the token and account reach the request');

$seen = [];
$spy = new Usage('acct-123', 'tok-abc', static function (string $url, array $headers, string $body) use (&$seen) {
    $seen = ['url' => $url, 'headers' => $headers, 'body' => $body];
    return ['status' => 200, 'body' => '{"data":{"viewer":{"accounts":[]}}}'];
});
$spy->daily(3);
check('it posts to the GraphQL endpoint', str_contains($seen['url'], 'api.cloudflare.com/client/v4/graphql'), $seen['url']);
check('with a bearer token', in_array('Authorization: Bearer tok-abc', $seen['headers'], true), $seen['headers']);
check('and the account id as a variable', str_contains($seen['body'], 'acct-123'), $seen['body']);
// One unknown field fails the whole query, so what it asks for is worth pinning down.
check('the query asks for requests', str_contains($seen['body'], 'requests'), $seen['body']);
check('and does NOT guess at a duration field', !str_contains($seen['body'], 'duration'), $seen['body']);

$spy2 = new Usage('a', 'b', static function (string $u, array $h, string $body) use (&$seen) {
    $seen = ['body' => $body];
    return ['status' => 200, 'body' => '{}'];
});
$spy2->daily(9999);
// Clamped, so a caller cannot ask Cloudflare for ten years of rows.
check('the day range is clamped', str_contains($seen['body'], gmdate('Y-m-d', time() - 30 * 86400)), $seen['body']);

group('usage: pressure against the ceiling');

check('half the ceiling is 50%', Usage::pressure(50_000, 100_000) === 50);
check('over the ceiling says so', Usage::pressure(150_000, 100_000) === 150);
check('nothing used is 0', Usage::pressure(0, 100_000) === 0);
// The distinction the whole panel turns on: unknown is not zero.
check('unknown usage is null, never 0', Usage::pressure(null, 100_000) === null);
check('and a zero ceiling does not divide by zero', Usage::pressure(1, 0) === null);

group('health: one target failing does not hide the others');

$health = new Health(static function (string $url) {
    if (str_contains($url, 'broken')) {
        return ['status' => 0, 'body' => 'Connection refused'];
    }
    if (str_contains($url, 'error')) {
        return ['status' => 500, 'body' => str_repeat('x', 400)];
    }
    return ['status' => 200, 'body' => '{"ok":true}'];
});

$rows = $health->check([
    'worker dev' => 'https://example.test/health',
    'worker prod' => 'https://broken.test/health',
    'site' => 'https://error.test/',
    'unset' => '',
]);

check('every target is reported', count($rows) === 4, $rows);
check('the healthy one is ok', $rows[0]['ok'] === true && $rows[0]['status'] === 200);
check('a refused connection is not ok', $rows[1]['ok'] === false && $rows[1]['status'] === 0);
check('and carries the transport error', str_contains($rows[1]['detail'], 'refused'));
check('a 500 is not ok', $rows[2]['ok'] === false && $rows[2]['status'] === 500);
// A 500 page can be a whole HTML document, and this lands in a JSON payload the admin
// renders into a page.
check('and its body is truncated', strlen($rows[2]['detail']) <= 120, strlen($rows[2]['detail']));
check('an unconfigured target says so rather than being called', $rows[3]['detail'] === 'not configured');

// 3xx is a normal answer for a site behind a redirect, so it must not read as down.
$redirect = new Health(static fn () => ['status' => 301, 'body' => '']);
check('a redirect counts as up', $redirect->check(['site' => 'https://example.test/'])[0]['ok'] === true);
$notFound = new Health(static fn () => ['status' => 404, 'body' => 'nope']);
check('but a 404 does not', $notFound->check(['site' => 'https://example.test/'])[0]['ok'] === false);

group('health: the deployed revision');

$dir = tempDir('rev');
check('no marker means unknown', Health::revision($dir) === null);

file_put_contents($dir . '/.deploy-revision', "76f3c78abc1234\n");
check('a SHA is read and trimmed', Health::revision($dir) === '76f3c78abc1234');

// A truncated upload or a stray file must not put arbitrary text into the page.
file_put_contents($dir . '/.deploy-revision', '<script>alert(1)</script>');
check('anything that is not a SHA is refused', Health::revision($dir) === null);

file_put_contents($dir . '/.deploy-revision', 'zzzz');
check('and so is non-hex', Health::revision($dir) === null);
