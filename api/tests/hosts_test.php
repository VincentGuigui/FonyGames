<?php

declare(strict_types=1);

/**
 * `shared/hosts.json` is the single place the deployed hostnames live.
 * Docs: docs/realtime-server.md §6
 *
 * Five files held their own copy of the workers.dev subdomain until one rename made
 * that obvious. Four of them now read the file; the two that cannot — `wrangler.jsonc`,
 * which is wrangler's own schema, and the allow-list in `testing.md`, which is text a
 * human pastes into a settings page — are checked here instead.
 *
 * The point of this file is that a rename stays a one-line edit. Change the subdomain
 * and nothing below needs touching; change a *worker name* and this fails until
 * `wrangler.jsonc` agrees.
 */

$root = dirname(__DIR__, 2);

$raw = file_get_contents($root . '/shared/hosts.json');
check('shared/hosts.json is readable', is_string($raw) && $raw !== '');

$hosts = json_decode((string) $raw, true);
check('and is valid JSON', is_array($hosts), json_last_error_msg());

$subdomain = (string) ($hosts['workersSubdomain'] ?? '');
$environments = $hosts['environments'] ?? [];

check('it names a workers.dev subdomain', str_ends_with($subdomain, '.workers.dev'), $subdomain);
check('and has both environments', isset($environments['dev'], $environments['prod']), array_keys($environments));

foreach ($environments as $name => $env) {
    check("{$name} has a site", ($env['site'] ?? '') !== '');
    check("{$name} has a worker", ($env['worker'] ?? '') !== '');
    // A leading scheme here would produce `wss://https://…` everywhere it is composed.
    check("{$name}'s site is a bare hostname", !str_contains((string) ($env['site'] ?? ''), '/'), $env['site'] ?? '');
    check("{$name}'s worker is a bare name", !str_contains((string) ($env['worker'] ?? ''), '.'), $env['worker'] ?? '');
}

// Two Workers, or a dev round could land in a production room.
check(
    'dev and prod are different Workers',
    ($environments['dev']['worker'] ?? 'a') !== ($environments['prod']['worker'] ?? 'b'),
);
check(
    'and different sites',
    ($environments['dev']['site'] ?? 'a') !== ($environments['prod']['site'] ?? 'b'),
);

/*
 * `wrangler.jsonc` cannot read the JSON — it IS the config wrangler parses — so the
 * worker names are duplicated there by necessity. If they disagree, the deploy
 * publishes to one name while the browser connects to another, and every game fails
 * with "Connection lost" while CI is green. Exactly the failure this repository
 * already had once, from a different cause.
 */
$wrangler = (string) file_get_contents($root . '/wrangler.jsonc');
foreach ($environments as $name => $env) {
    $worker = (string) ($env['worker'] ?? '');
    check(
        "wrangler.jsonc still names {$worker} for {$name}",
        str_contains($wrangler, "\"name\": \"{$worker}\""),
        $worker,
    );
}

/*
 * The allow-list in testing.md is text a human pastes into a settings page, so it
 * cannot read anything. It can at least be required to agree.
 */
$testing = (string) file_get_contents($root . '/docs/testing.md');
foreach ($environments as $name => $env) {
    $fqdn = "{$env['worker']}.{$subdomain}";
    check("testing.md's allow-list has {$fqdn}", str_contains($testing, $fqdn), $fqdn);
    check("and {$env['site']}", str_contains($testing, (string) $env['site']));
}

/*
 * And nothing anywhere still points at the old subdomain. A stale hostname does not
 * fail to compile — it resolves to nothing, or worse, to somebody else's Worker.
 */
$stale = [];
$skip = ['/node_modules/', '/dist/', '/dist-private/', '/.git/', '/.runtime/', '/.wrangler/'];
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($it as $file) {
    $path = (string) $file;
    // The iterator returns backslashes on Windows; the skip list is deliberately
    // platform-neutral. Without normalising, it scanned dependencies and local runtime
    // binaries, then treated Wrangler's own test hostname as project configuration.
    $portablePath = str_replace('\\', '/', $path);
    foreach ($skip as $fragment) {
        if (str_contains($portablePath, $fragment)) {
            continue 2;
        }
    }
    if (!is_file($path) || filesize($path) > 400_000) {
        continue;
    }
    $body = (string) file_get_contents($path);
    // Any workers.dev hostname that is not on the current subdomain.
    if (preg_match('/[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev/i', $body, $m) === 1) {
        if ($m[1] . '.workers.dev' !== $subdomain) {
            $stale[] = substr($portablePath, strlen(str_replace('\\', '/', $root)) + 1) . " ({$m[0]})";
        }
    }
}
check('no file points at a different workers.dev subdomain', $stale === [], $stale);
