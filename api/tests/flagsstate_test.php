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
 * **Nothing populates `game_flags`.** An absent row *means* the default — `active`, not new
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

$app->flags()->update('spill', ['availability' => 'disabled', 'reason' => 'balance pass']);
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
