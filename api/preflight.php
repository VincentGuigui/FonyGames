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

$header = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
$presented = (strpos($header, 'Bearer ') === 0) ? substr($header, 7) : '';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

// A short token is not a token. Refuse before comparing, so an empty ADMIN_TOKEN on the
// host cannot be matched by an empty header.
if (strlen($expected) < 16 || strlen($presented) < 16) {
    http_response_code(401);
    echo '{"error":"no"}';
    exit;
}

$match = function_exists('hash_equals')
    ? hash_equals($expected, $presented)
    : ($expected === $presented);

if (!$match) {
    http_response_code(401);
    echo '{"error":"no"}';
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
    'php' => PHP_VERSION,
    'phpId' => PHP_VERSION_ID,
    'phpRequired' => '8.1',
    'missingExtensions' => $missing,
    'migrationsDir' => $migrations,
    'migrations' => count($found),
));
