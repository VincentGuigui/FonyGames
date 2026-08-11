<?php

/**
 * Is this host capable of running the admin API at all?
 * Docs: docs/deployment.md §3.6c
 *
 * ## Why this file exists, and why it looks like 2013
 *
 * `api/index.php` and `api/lib/*.php` need **PHP 8.1**: `reply(): never` and App's
 * `readonly` promoted property are both 8.1 syntax. On an older interpreter they are a
 * PARSE error, and a parse error cannot be caught by anything inside the file that
 * failed to parse — PHP never gets as far as running our code. With `display_errors`
 * off, which is the norm on shared hosting, the request answers **500 with an empty
 * body** and no clue anywhere the deploy can see it. That is exactly how the first dev
 * deploy of the migration endpoint failed.
 *
 * So this file is deliberately written in the oldest syntax that does the job — no
 * types, no arrow functions, no `??`, no `str_contains` — because **it has to parse on
 * the interpreter that cannot parse the rest**. Nothing here may be modernised, however
 * much a linter would like it to be; that is the one property it has.
 *
 * It is not part of the API and answers nothing about flags. It reports what the host
 * is, so the deploy can say "your host runs 8.0.30, the API needs 8.1" instead of
 * "answered 500".
 */

// The token, and nothing else, gets an answer: the PHP version is mild information but
// it is still reconnaissance, and there is no reason to hand it to a crawler.
$config = dirname(__FILE__) . '/config.php';
$loaded = is_readable($config) ? require $config : array();
$expected = is_array($loaded) && isset($loaded['admin_token']) ? (string) $loaded['admin_token'] : '';

/*
 * Where the token may be, in the order `Auth::presentedToken()` uses.
 *
 * **`Authorization` is not reliably visible to PHP.** Apache consumes it and, behind a
 * CGI/FastCGI/FPM handler, does not forward it without `CGIPassAuth` — so the header can
 * be absent here while the client did send it, which looks identical to a wrong token.
 * `X-Admin-Token` needs no server cooperation, and over HTTPS it is exactly as private.
 */
$presented = '';
$via = 'nothing';
if (isset($_SERVER['HTTP_AUTHORIZATION']) && strpos($_SERVER['HTTP_AUTHORIZATION'], 'Bearer ') === 0) {
    $presented = substr($_SERVER['HTTP_AUTHORIZATION'], 7);
    $via = 'Authorization';
} elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])
    && strpos($_SERVER['REDIRECT_HTTP_AUTHORIZATION'], 'Bearer ') === 0) {
    $presented = substr($_SERVER['REDIRECT_HTTP_AUTHORIZATION'], 7);
    $via = 'REDIRECT_HTTP_AUTHORIZATION';
} elseif (isset($_SERVER['HTTP_X_ADMIN_TOKEN']) && $_SERVER['HTTP_X_ADMIN_TOKEN'] !== '') {
    $presented = $_SERVER['HTTP_X_ADMIN_TOKEN'];
    $via = 'X-Admin-Token';
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$match = strlen($expected) >= 16
    && strlen($presented) >= 16
    && (function_exists('hash_equals')
        ? hash_equals(hash('sha256', $expected), hash('sha256', $presented))
        : ($expected === $presented));

if (!$match) {
    /*
     * A refusal that says WHICH refusal. The first run of this file answered a bare
     * `{"error":"no"}` and the workflow guessed at one cause out of three; the guess was
     * unfalsifiable from CI, which is the failure this whole file exists to prevent.
     *
     * Booleans and lengths only — never a value, never a fragment of one. A length is not
     * a secret (the token is documented as `openssl rand -hex 32`), and it is decisive:
     * `tokenChars: 0` is a config that did not arrive, `presentedChars: 0` is a header this
     * host swallowed, and two non-zero numbers mean the values genuinely differ.
     */
    http_response_code(401);
    echo json_encode(array(
        'error' => 'no',
        'configReadable' => is_readable($config),
        'tokenChars' => strlen($expected),
        'presentedChars' => strlen($presented),
        'presentedVia' => $via,
    ));
    exit;
}

/* ── Authorised. Report what this host actually is. ────────────────────────── */

// 80101 is 8.1.1 in PHP_VERSION_ID's MMmmpp form; 80100 is 8.1.0. The API needs 8.1.
$minimum = 80100;
$required = array('pdo', 'pdo_mysql', 'json', 'session');

$missing = array();
foreach ($required as $extension) {
    if (!extension_loaded($extension)) {
        $missing[] = $extension;
    }
}

/*
 * The migration files, counted here because THE DEPLOY CANNOT SEE THEM. It uploads
 * `dist/db/` over SFTP and gets no manifest back, so "the sync worked" and "the sync
 * silently skipped a directory" look identical from the runner. Counting them on the
 * host is the only honest check, and it is one `glob` away.
 */
$migrations = dirname(dirname(__FILE__)) . '/db/migrations';
$found = is_dir($migrations) ? glob($migrations . '/*.sql') : array();
if (!is_array($found)) {
    $found = array();
}

$ok = PHP_VERSION_ID >= $minimum && count($missing) === 0 && count($found) > 0;

http_response_code($ok ? 200 : 503);
echo json_encode(array(
    'ok' => $ok,
    // Which header actually carried it, reported on SUCCESS too — not only on refusal.
    // `Authorization` is the one Apache can eat, so whether it survives on this host is a
    // standing fact worth having in the deploy log: if this says `X-Admin-Token`, then the
    // admin page's break-glass field only works because of the fallback, and anyone
    // debugging with plain `curl -H Authorization:` will be confused for an hour.
    'presentedVia' => $via,
    'php' => PHP_VERSION,
    'phpId' => PHP_VERSION_ID,
    'phpRequired' => '8.1',
    'missingExtensions' => $missing,
    'migrationsDir' => $migrations,
    'migrations' => count($found),
));
