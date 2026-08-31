<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/Auth.php';
require_once __DIR__ . '/../lib/Clock.php';
require_once __DIR__ . '/../lib/Mailer.php';
require_once __DIR__ . '/../lib/PdoAuthStore.php';

/**
 * The magic link.
 * Spec: docs/specs/backoffice.md §4
 *
 * One assertion per hole. The happy path gets four checks; everything else here is a
 * way the flow could be wrong while looking perfectly fine in a browser — which is
 * exactly why it moved out of "test it by clicking it".
 */

const ADMIN = 'vincent@guigui.fr';
const BASE = 'https://fonygames.guigui.fr/ops-7f3a91/';
const IP = '203.0.113.7';

/** @return array{Auth, FakeMailer, FakeClock, PdoAuthStore} */
function authFixture(string $adminEmail = ADMIN, string $adminToken = 'break-glass-token'): array
{
    $clock = new FakeClock(1_700_000_000_000);
    $store = new PdoAuthStore(testDb());
    $mailer = new FakeMailer();
    $auth = new Auth($store, $clock, $mailer, $adminEmail, $adminToken, BASE);

    return [$auth, $mailer, $clock, $store];
}

/** The token out of the link that was mailed. */
function tokenFromMail(FakeMailer $mailer): string
{
    $body = $mailer->last()['body'] ?? '';
    preg_match('/#([0-9a-f]{64})/', $body, $m);

    return $m[1] ?? '';
}

group('the happy path');

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
check('a link is mailed', count($mailer->sent) === 1);
check('to the configured address and nowhere else', $mailer->last()['to'] === ADMIN);

$token = tokenFromMail($mailer);
check('the token is 32 bytes of hex', strlen($token) === 64, strlen($token));
check('and it redeems', $auth->redeem($token) === true);

group('the token never reaches a server log');

[$auth, $mailer] = authFixture();
$auth->requestLink(ADMIN, IP);
$body = $mailer->last()['body'];
// A fragment is not sent to a server, so it cannot land in an access log, a Referer
// header or a proxy's history. A query string would land in all three.
check('the token is in the URL fragment', str_contains($body, BASE . '#' . tokenFromMail($mailer)));
check('and not in a query string', !str_contains($body, '?token='));
check('the link points at the configured base', str_starts_with($body, "Sign in") && str_contains($body, BASE));

group('nothing is stored that could be redeemed');

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
$token = tokenFromMail($mailer);
$row = $store->link();
check('the stored value is not the token', $row['hash'] !== $token);
check('it is the token’s SHA-256', $row['hash'] === hash('sha256', $token));
check('and it expires in ten minutes', $row['expiresAt'] === 1_700_000_000_000 + Auth::LINK_TTL_MS);

group('a wrong address is indistinguishable from the right one');

[$auth, $mailer] = authFixture();
$auth->requestLink('someone-else@example.com', IP);
check('no mail is sent', count($mailer->sent) === 0);
// `requestLink` returns void, so a caller CANNOT branch on the outcome even by
// accident. That is the property, and it is enforced by the signature rather than by
// the endpoint remembering to answer 204 both ways.
$rt = (new ReflectionMethod(Auth::class, 'requestLink'))->getReturnType();
check('and requestLink cannot report which it was', $rt instanceof ReflectionNamedType && $rt->getName() === 'void');

group('capitals and padding still reach the operator');

[$auth, $mailer] = authFixture();
$auth->requestLink('  Vincent@Guigui.FR ', IP);
// A phone capitalises the first letter and a paste brings spaces. A link the operator
// cannot request is not security, it is a bug.
check('a phone-typed address still works', count($mailer->sent) === 1);
check('and the mail goes to the configured spelling', $mailer->last()['to'] === '  Vincent@Guigui.FR ');

group('an unset address matches NOBODY');

[$auth, $mailer] = authFixture('');
$auth->requestLink('', IP);
check('an empty request against an empty config sends nothing', count($mailer->sent) === 0);
$auth->requestLink(ADMIN, IP);
check('and neither does the real address', count($mailer->sent) === 0);

group('a link is single use');

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
$token = tokenFromMail($mailer);
check('the first redeem works', $auth->redeem($token) === true);
check('the second does not', $auth->redeem($token) === false);
check('and the row is gone, so nothing is left to replay', $store->link() === null, $store->link());

group('a wrong guess does not burn the operator’s link');

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
$token = tokenFromMail($mailer);
check('a junk token is refused', $auth->redeem('nope') === false);
check('an empty token is refused', $auth->redeem('') === false);
check('a hex string of the right length is refused', $auth->redeem(str_repeat('a', 64)) === false);
// Deleting on every attempt would let anyone who knows the admin URL destroy the
// operator's outstanding link by posting junk — a free denial of service.
check('and the real token still works afterwards', $auth->redeem($token) === true);

group('a link expires');

[$auth, $mailer, $clock] = authFixture();
$auth->requestLink(ADMIN, IP);
$token = tokenFromMail($mailer);
$clock->advance(Auth::LINK_TTL_MS - 1);
check('it still works one millisecond before the deadline', $auth->redeem($token) === true);

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
$token = tokenFromMail($mailer);
$clock->advance(Auth::LINK_TTL_MS + 1);
check('and not one millisecond after', $auth->redeem($token) === false);
check('the expired row is cleared rather than left lying around', $store->link() === null);

group('a new request replaces the old link');

[$auth, $mailer, $clock] = authFixture();
$auth->requestLink(ADMIN, IP);
$first = tokenFromMail($mailer);
$clock->advance(1_000);
$auth->requestLink(ADMIN, IP);
$second = tokenFromMail($mailer);
check('two different tokens were minted', $first !== $second);
check('the older one is dead', $auth->redeem($first) === false);
check('the newer one works', $auth->redeem($second) === true);

group('the rate limit is not an oracle');

[$auth, $mailer, $clock] = authFixture();
for ($i = 0; $i < Auth::LINK_MAX; $i++) {
    $auth->requestLink(ADMIN, IP);
}
check('the allowance is spent, not exceeded', count($mailer->sent) === Auth::LINK_MAX, count($mailer->sent));
$auth->requestLink(ADMIN, IP);
check('the next one is dropped', count($mailer->sent) === Auth::LINK_MAX);

// THE assertion of this group. Wrong addresses must be counted too — otherwise an
// attacker learns the right address by noticing that only wrong ones never get rate
// limited.
[$auth, $mailer, $clock] = authFixture();
for ($i = 0; $i < Auth::LINK_MAX + 1; $i++) {
    $auth->requestLink('guess' . $i . '@example.com', IP);
}
$auth->requestLink(ADMIN, IP);
check('wrong guesses consume the allowance, so the right address is silenced too', count($mailer->sent) === 0);

group('the rate limit is per caller, and it recovers');

[$auth, $mailer, $clock] = authFixture();
for ($i = 0; $i <= Auth::LINK_MAX; $i++) {
    $auth->requestLink(ADMIN, IP);
}
$spent = count($mailer->sent);
$auth->requestLink(ADMIN, '198.51.100.4');
check('a different caller has their own allowance', count($mailer->sent) === $spent + 1);

$clock->advance(Auth::LINK_WINDOW_MS + 1);
$auth->requestLink(ADMIN, IP);
check('and the window rolls off', count($mailer->sent) === $spent + 2);

group('the attempts table does not grow forever');

[$auth, $mailer, $clock, $store] = authFixture();
for ($i = 0; $i < 3; $i++) {
    $auth->requestLink(ADMIN, IP);
    $clock->advance(60_000);
}
$clock->advance(Auth::LINK_WINDOW_MS);
$auth->requestLink(ADMIN, IP);
check('old attempts are pruned', $store->countAttempts(hash('sha256', IP), 0) === 1, $store->countAttempts(hash('sha256', IP), 0));

group('no IP address is stored');

[$auth, $mailer, $clock, $store] = authFixture();
$auth->requestLink(ADMIN, IP);
check('the raw address is not the key', $store->countAttempts(IP, 0) === 0);
check('its hash is', $store->countAttempts(hash('sha256', IP), 0) === 1);

group('a broken mailer is our fault, and says so');

[$auth, $mailer] = authFixture();
$mailer->working = false;
$threw = false;
try {
    $auth->requestLink(ADMIN, IP);
} catch (RuntimeException) {
    $threw = true;
}
// The one thing that DOES surface: an operator staring at a link that never arrived
// cannot otherwise tell a broken mailer from a spam folder.
check('a refused send throws so the endpoint can answer 502', $threw);

[$auth, $mailer] = authFixture();
$mailer->working = false;
$quiet = true;
try {
    $auth->requestLink('someone-else@example.com', IP);
} catch (RuntimeException) {
    $quiet = false;
}
// ...but only for a mail we wanted to send. Throwing for a wrong address would turn
// the broken mailer into the address oracle everything else avoids.
check('and stays silent for an address we were never going to mail', $quiet);

group('the break-glass token');

[$auth] = authFixture();
check('the right bearer is accepted', $auth->authorisedByToken('Bearer break-glass-token') === true);
check('a wrong one is not', $auth->authorisedByToken('Bearer nope') === false);
check('a missing header is not', $auth->authorisedByToken(null) === false);
check('a bare token with no scheme is not', $auth->authorisedByToken('break-glass-token') === false);
check('the wrong scheme is not', $auth->authorisedByToken('Basic break-glass-token') === false);
check('a prefix of the token is not', $auth->authorisedByToken('Bearer break-glass') === false);
check('the token with something appended is not', $auth->authorisedByToken('Bearer break-glass-tokenX') === false);

// The trap: an unset break-glass token must authorise NOBODY. A naive
// `$header === "Bearer " . $this->adminToken` would accept "Bearer " on a host where
// the secret was never configured.
[$auth] = authFixture(ADMIN, '');
check('an unset token authorises nobody', $auth->authorisedByToken('Bearer ') === false);
check('not even an empty bearer', $auth->authorisedByToken('Bearer') === false);
check('and not the string it would have been', $auth->authorisedByToken('Bearer ""') === false);

group('the comparisons do not leak a length');

// hash_equals returns false immediately when the lengths differ, so comparing raw
// values leaks the secret's length through timing. Both comparisons hash first, which
// makes every comparison the same 64 bytes. Asserted structurally — a timing
// measurement in a test suite is a flaky test, not a proof.
$source = (string) file_get_contents(__DIR__ . '/../lib/Auth.php');
check(
    'constantTimeEquals hashes both sides before comparing',
    (bool) preg_match('/hash_equals\(\s*hash\(\'sha256\', \$a\),\s*hash\(\'sha256\', \$b\)\s*,?\s*\)/', $source),
);
check(
    'the address comparison goes through it',
    str_contains($source, 'return $this->constantTimeEquals(') && str_contains($source, 'strtolower(trim($email))'),
);
/*
 * The bearer comparison moved to the STATIC `tokenMatches()`, so that authorisation can be
 * settled before anything opens a database connection (App::tokenMatches, and the ordering
 * in api/index.php). A static cannot call `$this->constantTimeEquals`, so the hashing is
 * written out there — which is exactly the kind of duplication that quietly loses a
 * property, so it is asserted on its own rather than trusted.
 */
check(
    'the bearer comparison hashes both sides too',
    (bool) preg_match(
        '/hash_equals\(\s*hash\(\'sha256\', \$expected\),\s*hash\(\'sha256\', \$presented\)\s*,?\s*\)/',
        $source,
    ),
);

group('the admin session survives browser restarts within its TTL');
$index = (string) file_get_contents(__DIR__ . '/../index.php');
check('the cookie has a persistent TTL', str_contains($index, "'lifetime' => (int) (SESSION_TTL_S)"));
check('PHP session garbage collection matches the TTL', str_contains($index, "ini_set('session.gc_maxlifetime', (string) (SESSION_TTL_S))"));
check(
    'and the instance method delegates to it rather than comparing again',
    (bool) preg_match(
        '/public function authorisedByToken\(\?string \$header\): bool\s*\{\s*'
        . 'return self::tokenMatches\(self::tokenFromHeader\(\$header\), \$this->adminToken\);\s*\}/',
        $source,
    ),
);

group('a database hiccup during redeem is diagnosable, not a bare 500');

/*
 * `session` used to be the only database-touching action in index.php with no guard
 * at all — every other one calls `requireSchema()` or its own try/catch, and reports
 * a diagnosable 503 when the database misbehaves mid-request. A PDOException here
 * fell straight through to `crash()`'s generic, undiagnosable 500 — at the exact
 * moment an operator has just clicked their magic link and has no other way in.
 */
check(
    'redeem() is called inside its own guard',
    str_contains($index, "case 'session':") && str_contains($index, '$redeemed = $auth->redeem($token);'),
);
check(
    'and a PDOException there answers the same diagnosable shape every other DB guard in this file uses',
    (bool) preg_match(
        '/\$redeemed = \$auth->redeem\(\$token\);\s*\} catch \(PDOException \$e\) \{\s*reply\(503,\s*\[\s*'
        . "'error' => 'the database is not reachable from this host',\s*"
        . "'dbUnreachable' => true,/",
        $index,
    ),
);

group('the token is found wherever this host puts it');

/*
 * `Authorization` is NOT reliably visible to PHP: Apache consumes it and, behind a
 * CGI/FastCGI/FPM handler, does not forward it without `CGIPassAuth`. On the dev host it
 * never arrived, and a swallowed header is indistinguishable from a wrong token — the
 * deploy's preflight answered 401 and blamed a stale config.
 *
 * So three sources are accepted, in this order. The custom one needs no server
 * cooperation, which is the whole reason it exists.
 */
check('the standard header', Auth::presentedToken(['HTTP_AUTHORIZATION' => 'Bearer abc']) === 'abc');
check(
    'the mod_rewrite alias, when Apache moved it',
    Auth::presentedToken(['REDIRECT_HTTP_AUTHORIZATION' => 'Bearer abc']) === 'abc',
);
check('the custom header, raw and unprefixed', Auth::presentedToken(['HTTP_X_ADMIN_TOKEN' => 'abc']) === 'abc');
check('nothing at all is null, not empty string', Auth::presentedToken([]) === null);

// Precedence matters: a host that behaves normally must behave normally, so the standard
// header wins and the fallback cannot override it.
check(
    'the standard header wins over the custom one',
    Auth::presentedToken(['HTTP_AUTHORIZATION' => 'Bearer real', 'HTTP_X_ADMIN_TOKEN' => 'other']) === 'real',
);
// An empty custom header is a header that was sent blank; treating it as a token would
// hand `tokenMatches` an empty string to compare.
check('an empty custom header is not a token', Auth::presentedToken(['HTTP_X_ADMIN_TOKEN' => '']) === null);
check('a bare token in Authorization is refused', Auth::presentedToken(['HTTP_AUTHORIZATION' => 'abc']) === null);
check('and so is an empty Bearer', Auth::presentedToken(['HTTP_AUTHORIZATION' => 'Bearer ']) === null);

// The comparison itself takes the RAW token now, not the header, so a caller cannot
// accidentally compare "Bearer x" against "x" and always fail.
check('an unset expected token authorises nobody', Auth::tokenMatches('anything', '') === false);
check('a null presentation authorises nobody', Auth::tokenMatches(null, 'real') === false);
check('and the right token does', Auth::tokenMatches('real', 'real') === true);

group('preflight.php stays parseable by an OLD interpreter');

/*
 * The file's entire purpose is to run where index.php cannot: it reports the PHP version
 * when the API's own 8.1 syntax is a parse error. A type declaration or an arrow function
 * added here would make it die exactly where it is needed, so the property is asserted
 * rather than left to a comment nobody re-reads (docs/deployment.md §3.6c).
 */
/*
 * `php_strip_whitespace` rather than the raw file: it tokenises and drops comments, so the
 * header's own prose about not using `??` does not count as using it. The first version of
 * this group failed on its own documentation.
 */
$pre = php_strip_whitespace(__DIR__ . '/../preflight.php');
check('no strict_types declaration', !str_contains($pre, 'declare(strict_types'));
check('no null coalescing', !str_contains($pre, '??'));
check('no arrow functions', !str_contains($pre, 'fn('));
check('no 8.0 string helpers', !str_contains($pre, 'str_contains(') && !str_contains($pre, 'str_starts_with('));
check('no scalar type declarations', preg_match('/function \w+\([^)]*\b(string|int|bool|array) \$/', $pre) === 0);
check('no return types', preg_match('/function \w+\([^)]*\)\s*:/', $pre) === 0);
// `[...]` is 5.4, so it would parse — but `array()` is what the file uses throughout and a
// mixed style here invites "tidying" it towards modern syntax, which is the actual hazard.
check('array() throughout, not []', !str_contains($pre, '=> [') && !str_contains($pre, 'array(['));
