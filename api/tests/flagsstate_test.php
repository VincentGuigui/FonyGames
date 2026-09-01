<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/App.php';

/**
 * What the health panel says about `flags.json`.
 * Spec: docs/specs/backoffice.md §2b
 *
 * This exists because the first version conflated two states and was actively misleading.
 *
 * **Nothing populates `games`.** An absent row *means* the default — `active`, not new
 * — so a row only appears the first time a game is changed. An empty table with no published
 * file is therefore a **working, untouched install**, and the old wording called it a
 * failure: *"flags.json is missing — the Worker is failing open"*. True in the letter, and it
 * sends the operator hunting for a fault that is the normal first-run state.
 *
 * The state that genuinely is a fault is **rows but no file**: something has been set and the
 * file everything READS does not reflect it, so the Worker enforces the old answer while the
 * admin page shows the new one. Only that one should be loud.
 */

/** An App whose config points at the test database and a scratch flags path. */
function stateFixture(string $dir): App
{
    $candidate = testDbUsed();
    $config = "<?php return " . var_export([
        'db_dsn' => $candidate['dsn'],
        'db_user' => $candidate['user'],
        'db_pass' => $candidate['pass'],
        'admin_email' => 'vincent@guigui.fr',
        'flags_path' => $dir . '/flags.json',
    ], true) . ';';

    file_put_contents($dir . '/config.php', $config);

    return App::boot($dir);
}

group('an untouched install is not a fault');

$dir = tempDir('fstate');
testDb();                       // schema present, every table empty
$app = stateFixture($dir);

$state = $app->flagsState();
// No rows and no file: the steady state of an install nobody has configured.
check('no rows and no file reads as OK', $state['ok'] === true, $state);
check('and explains that empty IS the default', str_contains($state['detail'], 'that is the'), $state['detail']);
check('naming what a player sees', str_contains($state['detail'], 'every game is active'), $state['detail']);
// The words that used to be here and should not be, because nothing is failing.
check('without claiming the Worker is failing open', !str_contains($state['detail'], 'failing open'), $state['detail']);

group('published and empty is also not a fault');

$app->flags()->republish();
check('the file now exists', is_readable($dir . '/flags.json'));
$state = $app->flagsState();
check('it reads as OK', $state['ok'] === true, $state);
check('and says published and empty', str_contains($state['detail'], 'published and empty'), $state['detail']);
check('still naming the default', str_contains($state['detail'], 'every game is active'), $state['detail']);

group('a flag that IS set is counted');

$app->flags()->update('spill', ['state' => 'soon', 'reason' => 'balance pass']);
$state = $app->flagsState();
check('it reads as OK', $state['ok'] === true, $state);
check('and reports the count', str_contains($state['detail'], '1 flag(s)'), $state['detail']);

group('rows but NO file is the one that shouts');

unlink($dir . '/flags.json');
$state = $app->flagsState();
// THE assertion. The store says a game is disabled and the file everything reads does not,
// so the Worker is enforcing the old answer while the page shows the new one.
check('it is NOT ok', $state['ok'] === false, $state);
check('it says the file is missing', str_contains($state['detail'], 'MISSING'), $state['detail']);
check('names the count that is at risk', str_contains($state['detail'], '1 flag(s)'), $state['detail']);
check('says what the consequence is', str_contains($state['detail'], 'failing open'), $state['detail']);
check('and what to do about it', str_contains($state['detail'], 'republish'), $state['detail']);

group('no schema at all says so, rather than guessing');

$bare = tempDir('fbare');
$candidate = testDbUsed();
// A database that exists but has no tables — the state of a host between deploy and
// migration.
$empty = testDbSecond('fstate');
file_put_contents($bare . '/config.php', "<?php return " . var_export([
    'db_dsn' => (string) preg_replace('/dbname=[^;]+/', 'dbname=fonygames_fstate_test', $candidate['dsn']),
    'db_user' => $candidate['user'],
    'db_pass' => $candidate['pass'],
    'admin_email' => 'vincent@guigui.fr',
    'flags_path' => $bare . '/flags.json',
], true) . ';');

$state = App::boot($bare)->flagsState();
// Not a warning: the schema panel is what reports this, and two components shouting about
// the same thing reads as two problems.
check('it reads as OK, because the schema panel owns this one', $state['ok'] === true, $state);
check('and says the schema is not installed', str_contains($state['detail'], 'schema is not installed'), $state['detail']);

group('a failed publish says WHY, not just false');

/*
 * `publish()` returned a bare false, and the panel's advice was "use republish" — which
 * writes to the same path and fails the same way, so the operator clicks a button that
 * cannot work. This is the same lesson as the empty 500: a failure that cannot name itself
 * costs more than the failure.
 */
$dir = tempDir('pub');
check('a writable directory has nothing to report', Flags::publishDiagnosis($dir . '/flags.json') === null);
check(
    'a missing directory says so',
    Flags::publishDiagnosis($dir . '/nope/flags.json') === "the directory {$dir}/nope does not exist",
);

// THE case that matters, and the one that is invisible from the symptom: tempnam() falls
// back to the system temp dir when the target is unwritable, so the rename then fails as a
// cross-device move and reads as a mysterious rename bug.
$locked = tempDir('locked');
chmod($locked, 0555);

/*
 * Skipped as root, which ignores the mode bits entirely — `is_writable` returns true for a
 * 0555 directory and the assertion would fail for a reason that has nothing to do with the
 * code. CI runs as root, so this group is the one part of the suite that is genuinely
 * environment-dependent, and it says so rather than being quietly weakened to always pass.
 */
if (function_exists('posix_geteuid') && posix_geteuid() !== 0) {
    $why = Flags::publishDiagnosis($locked . '/flags.json');
    check('an unwritable directory names the permission', is_string($why) && str_contains($why, 'not writable'), $why);
    check('and explains the cross-device rename', is_string($why) && str_contains($why, 'across filesystems'), $why);
    // publish() must refuse rather than leave a file in /tmp and report a rename failure.
    check('publish() refuses instead of writing to the system temp dir', Flags::publish($locked . '/flags.json', '{}') === false);
    check('and leaves nothing behind', glob(sys_get_temp_dir() . '/.flags*') === []);
} else {
    check('running as root, so the unwritable-directory group is skipped', true);
}

chmod($locked, 0755);

$ok = $dir . '/flags.json';
check('a real publish still works', Flags::publish($ok, '{"flags":{}}') === true);
check('and the file is readable by the web server', (fileperms($ok) & 0044) === 0044, substr(sprintf('%o', fileperms($ok)), -4));
