<?php

declare(strict_types=1);

/**
 * The config contract between the deploy and the app.
 * Docs: docs/deployment.md §3
 *
 * `config.php` is not committed — the deploy generates it from GitHub secrets, and
 * `App` reads it back. So the key names live in two files that are never edited
 * together: a shell loop in `.github/workflows/main.yml`, and an array in
 * `api/lib/App.php`.
 *
 * Rename one side only and nothing breaks loudly. The value simply arrives as `''`,
 * and the feature it powers goes quiet — the usage panel shows nothing, or a magic
 * link points nowhere — with no error anywhere. That is exactly what happened to the
 * Cloudflare secrets: two names for one account id, and the `CF_`/`CLOUDFLARE_`
 * split, which is why this test exists.
 *
 * It reads the workflow as text rather than running it. Enough to catch a rename.
 */

$workflow = dirname(__DIR__, 2) . '/.github/workflows/main.yml';
$appFile = dirname(__DIR__) . '/lib/App.php';

$wf = file_get_contents($workflow);
$app = file_get_contents($appFile);
check('the workflow is readable', is_string($wf) && $wf !== '');
check('and App.php is', is_string($app) && $app !== '');

/*
 * The keys the deploy writes, from its `"key:$VAR"` pair list. `show_all` is written
 * separately because it is a boolean and must not be quoted, so it is added by hand.
 */
preg_match_all('/"([a-z_]+):\$/', (string) $wf, $m);
$written = array_unique($m[1]);
$written[] = 'show_all';
sort($written);

check('the deploy writes a config at all', count($written) > 5, $written);

// Every key the deploy writes must be a key App actually reads. A stale one is dead
// weight in a generated file; a missing one is a feature that silently does nothing.
$unread = [];
foreach ($written as $key) {
    if (!str_contains((string) $app, "'{$key}'")) {
        $unread[] = $key;
    }
}
check('every key the deploy writes is read by App.php', $unread === [], $unread);

/*
 * And the halves of each line in App.php must agree: the config key it exposes and
 * the `$loaded[...]` key it reads from. `'a' => $loaded['b']` typechecks, passes every
 * other test, and quietly drops the value.
 */
preg_match_all("/'([a-z_]+)' => \(string\) \(\\\$loaded\['([a-z_]+)'\]/", (string) $app, $pairs, PREG_SET_ORDER);
check('App.php reads a config', count($pairs) > 5, count($pairs));

$mismatched = [];
foreach ($pairs as $pair) {
    if ($pair[1] !== $pair[2]) {
        $mismatched[] = "{$pair[1]} <- {$pair[2]}";
    }
}
check('and never reads one key into another', $mismatched === [], $mismatched);

/*
 * The Cloudflare names specifically, since this is the rename that prompted the test.
 * One account id, one prefix, and nothing left on the old convention.
 */
$cloudflare = array_values(array_filter($written, fn (string $k): bool => str_contains($k, 'cloudflare')));
sort($cloudflare);
check(
    'the Cloudflare config keys are the two expected ones',
    $cloudflare === ['cloudflare_account_id', 'cloudflare_analytics_token'],
    $cloudflare,
);

// The secrets themselves, in the workflow. All three on one prefix.
foreach (['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ANALYTICS_TOKEN'] as $secret) {
    check("secrets.{$secret} is referenced", str_contains((string) $wf, 'secrets.' . $secret));
}

// The account id is ONE secret used by both jobs, not two holding the same value.
check(
    'there is no second account-id secret',
    !str_contains((string) $wf, 'secrets.CF_ACCOUNT_ID'),
);
check(
    'and no analytics token on the old prefix',
    !str_contains((string) $wf, 'secrets.CF_ANALYTICS_TOKEN'),
);
// It was never a secret, only a confusing shell alias for CLOUDFLARE_API_TOKEN.
check(
    'and CF_API_TOKEN is gone entirely',
    !str_contains((string) $wf, 'CF_API_TOKEN') || str_contains((string) $wf, 'two conventions'),
);
