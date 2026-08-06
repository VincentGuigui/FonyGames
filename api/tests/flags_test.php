<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/Clock.php';
require_once __DIR__ . '/../lib/Flags.php';
require_once __DIR__ . '/../lib/FlagService.php';
require_once __DIR__ . '/../lib/PdoFlagStore.php';

/**
 * The flag store and the published file.
 * Spec: docs/specs/backoffice.md §2b
 *
 * Written against the holes rather than the happy path. The expensive failure here is
 * not "a flag did not save" — the admin page would show that immediately — it is
 * "the flag saved and the published file did not change", because then the Worker
 * keeps opening rooms for a game the operator believes they disabled, and every
 * screen agrees with them.
 */

group('a slug is sanitised the same way the Worker sanitises it');

// The same table worker/router.test.ts asserts. Two copies of a rule, so two copies
// of the test — that is the price of the guard existing on both sides, and it is
// cheaper than a mismatch that turns the join field into an open redirect.
foreach (['tap-duel', 'spill', 'a', 'cat-and-mouse', 'a1', 'a-1-b'] as $good) {
    check("accepts {$good}", Flags::slug($good) === $good);
}

$bad = [
    '' => 'empty',
    '../etc/passwd' => 'a traversal',
    '//evil.test' => 'a protocol-relative host',
    'https://evil.test' => 'a full URL',
    'Tap-Duel' => 'capitals',
    '1st-game' => 'a leading digit',
    '-leading' => 'a leading dash',
    'tap_duel' => 'an underscore',
    'tap duel' => 'a space',
    "tap-duel\n" => 'a trailing newline',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' => '33 characters',
];
foreach ($bad as $input => $why) {
    check("rejects {$why}", Flags::slug($input) === null, $input);
}

// 32 is the boundary, and boundaries are where off-by-ones live.
check('accepts exactly 32 characters', Flags::slug(str_repeat('a', 32)) === str_repeat('a', 32));

// The pattern now exists in two languages, and a comment saying "keep these in step"
// is not a mechanism. So: read both source files and compare the literals. If someone
// widens the Worker's guard and not this one, a slug the Worker accepts gets stored
// here as nothing — or worse, the other way round.
$tsSource = (string) file_get_contents(__DIR__ . '/../../worker/router.ts');
$phpSource = (string) file_get_contents(__DIR__ . '/../lib/Flags.php');
$core = '^[a-z][a-z0-9-]{0,31}$';
check('worker/router.ts still uses the pattern this file mirrors', str_contains($tsSource, $core));
check('and Flags::slug() still uses the same one', str_contains($phpSource, $core));

// PCRE-only trap, so it cannot be shared with the TypeScript side: without the `D`
// modifier, `$` also matches immediately before a trailing newline, so "spill\n"
// would pass. There is a `rejects a trailing newline` check above; this one names
// *why* it passes, so removing the modifier fails with a comprehensible message
// rather than an unexplained input.
check('and keeps the /D modifier that makes $ mean end-of-string', str_contains($phpSource, $core . '/D'));

group('a patch is partial, and merges');

$flags = [];
$flags = Flags::apply($flags, 'spill', ['availability' => Flags::DISABLED]);
check('an unknown slug starts from the default', $flags['spill']['isNew'] === false, $flags);
check('and takes the patched availability', $flags['spill']['availability'] === Flags::DISABLED);

$flags = Flags::apply($flags, 'spill', ['isNew' => true]);
check('a later patch does not reset the other field', $flags['spill']['availability'] === Flags::DISABLED, $flags);
check('and sets its own', $flags['spill']['isNew'] === true);

// A game can be new AND disabled — the whole reason these are two fields rather than
// one four-value enum (spec §5).
check('new and disabled coexist', $flags['spill'] === [
    'availability' => Flags::DISABLED,
    'isNew' => true,
]);

$flags = Flags::apply($flags, 'spill', ['availability' => 'banana', 'isNew' => 'yes']);
check('a bad availability is ignored, not stored', $flags['spill']['availability'] === Flags::DISABLED, $flags);
check('a bad isNew is ignored, not coerced', $flags['spill']['isNew'] === true);

group('a reason is absent, never empty');

$flags = Flags::apply($flags, 'spill', ['reason' => 'back on Friday']);
check('a reason is stored', ($flags['spill']['reason'] ?? null) === 'back on Friday');

$flags = Flags::apply($flags, 'spill', ['reason' => '   ']);
check('whitespace clears it rather than storing a blank badge', !array_key_exists('reason', $flags['spill']), $flags);

$flags = Flags::apply($flags, 'spill', ['reason' => str_repeat('x', 200)]);
check('a long reason is truncated to the cap', mb_strlen($flags['spill']['reason']) === Flags::REASON_MAX);

$flags = Flags::apply($flags, 'spill', ['reason' => null]);
check('null clears it', !array_key_exists('reason', $flags['spill']));

group('the published JSON is the shape shared/flags.ts expects');

$json = Flags::encode(['spill' => ['availability' => Flags::HIDDEN, 'isNew' => false]]);
$back = json_decode($json, true);
check('wrapped in a flags key', isset($back['flags']['spill']));
check('availability survives', $back['flags']['spill']['availability'] === Flags::HIDDEN);
check('isNew is a real boolean, not 0', $back['flags']['spill']['isNew'] === false, $json);

// The fresh-install case. PHP's empty array encodes as `[]`, and a reader doing
// `flags.flags[slug]` on an array gets undefined at best — so an empty map must be
// an object.
check('an empty map encodes as an object', str_contains(Flags::encode([]), '"flags":{}'), Flags::encode([]));

// The file is world-readable — the Worker fetches it over HTTPS — so what is *not*
// in it matters as much as what is. Asserted by whitelisting the keys rather than by
// searching for a string: a `str_contains($json, 'at')` would have passed here and
// then failed the day a slug called `cat-and-mouse` was added.
$encoded = json_decode(Flags::encode([
    'cat-and-mouse' => ['availability' => Flags::DISABLED, 'isNew' => true, 'reason' => 'why'],
]), true);
check('the payload has exactly one top-level key', array_keys($encoded) === ['flags'], $encoded);
check(
    'and a flag carries only the three GameFlag fields',
    array_keys($encoded['flags']['cat-and-mouse']) === ['availability', 'isNew', 'reason'],
    $encoded['flags']['cat-and-mouse'],
);

group('the store round-trips through real SQL');

$clock = new FakeClock(1_000_000);
$store = new PdoFlagStore(testDb(), $clock);

check('an empty store loads an empty map', $store->load() === []);

$store->put('spill', ['availability' => Flags::DISABLED, 'isNew' => true, 'reason' => 'maintenance']);
$loaded = $store->load();
check('a stored flag comes back whole', $loaded === [
    'spill' => ['availability' => Flags::DISABLED, 'isNew' => true, 'reason' => 'maintenance'],
], $loaded);

$store->put('spill', ['availability' => Flags::ACTIVE, 'isNew' => false]);
$loaded = $store->load();
check('a second write updates rather than duplicating', count($loaded) === 1, $loaded);
check('and clears the reason when the new flag has none', !array_key_exists('reason', $loaded['spill']), $loaded);

$store->put('tap-duel', ['availability' => Flags::HIDDEN, 'isNew' => false]);
check('slugs come back sorted', array_keys($store->load()) === ['spill', 'tap-duel']);

$threw = false;
try {
    $store->put('../etc/passwd', ['availability' => Flags::ACTIVE, 'isNew' => false]);
} catch (InvalidArgumentException) {
    $threw = true;
}
check('the store refuses a bad slug outright', $threw);

group('every change leaves an audit row, in the same transaction');

$history = $store->history();
check('three writes, three rows', count($history) === 3, $history);
check('newest first', $history[0]['slug'] === 'tap-duel', $history);
check('the row records the state it set', $history[0]['availability'] === Flags::HIDDEN);
check('and when', $history[0]['at'] === 1_000_000);

$clock->advance(5_000);
$store->put('spill', ['availability' => Flags::DISABLED, 'isNew' => false]);
$history = $store->history();
check('a later write is timestamped later', $history[0]['at'] === 1_005_000, $history[0]);

check('history is bounded', count($store->history(2)) === 2);

group('the file can never be behind the database');

$dir = tempDir();
$path = $dir . '/flags.json';
$service = new FlagService(new PdoFlagStore(testDb(), $clock), $path);

check('nothing published yet reads as no flags', Flags::read($path) === []);

$result = $service->update('spill', ['availability' => Flags::DISABLED, 'reason' => 'back Friday']);
check('the update reports success', $result !== null && $result['published'] === true, $result);

// The invariant this whole class exists for: one call, and the file on disk already
// agrees with the store. A route that updated the store and forgot to republish
// would leave the Worker enforcing the old answer while every screen showed the new
// one.
$published = Flags::read($path);
check('the published file already matches the store', $published === $service->all(), [$published, $service->all()]);
check('and holds the disabled state', $published['spill']['availability'] === Flags::DISABLED);
check('and the reason', ($published['spill']['reason'] ?? null) === 'back Friday');

check('a bad slug updates nothing and reports it', $service->update('//evil.test', ['availability' => Flags::HIDDEN]) === null);
check('and left the file alone', Flags::read($path)['spill']['availability'] === Flags::DISABLED);

group('the published file is replaced atomically');

// Not observable by racing it in a single-threaded test, so the property is checked
// where it actually lives: publish() must not truncate the target. If it wrote in
// place, a reader mid-write would see a partial document, fail to parse, and fail
// open — turning a disabled game playable for the duration of every write.
$before = fileinode($path);
clearstatcache();
$service->update('tap-duel', ['availability' => Flags::HIDDEN]);
clearstatcache();
check('the file is a new inode, i.e. renamed into place', fileinode($path) !== $before, [$before, fileinode($path)]);

$leftovers = array_values(array_filter(
    scandir($dir) ?: [],
    static fn (string $f): bool => str_starts_with($f, '.flags'),
));
check('no temp files are left behind', $leftovers === [], $leftovers);

check('the published file is world-readable', (fileperms($path) & 0044) === 0044, decoct(fileperms($path)));

group('reading the file fails open, always');

file_put_contents($path, '{"flags":{"spill":{"availabil');
check('half a document reads as no flags', Flags::read($path) === []);

file_put_contents($path, 'null');
check('valid JSON of the wrong shape reads as no flags', Flags::read($path) === []);

file_put_contents($path, '{"flags":{"spill":{"availability":"banana","isNew":1}}}');
$read = Flags::read($path);
check('an availability outside the enum falls back to active', $read['spill']['availability'] === Flags::ACTIVE, $read);
check('and a truthy non-boolean isNew is not trusted', $read['spill']['isNew'] === false, $read);

file_put_contents($path, '{"flags":{"../etc/passwd":{"availability":"hidden","isNew":false}}}');
check('a hand-edited bad slug is dropped on read', Flags::read($path) === [], Flags::read($path));

check('a missing file reads as no flags', Flags::read($dir . '/nope.json') === []);

group('republish repairs a file that failed to write');

@unlink($path);
check('the file is gone', !file_exists($path));
check('republish reports success', $service->republish() === true);
check('and restores it from the store', Flags::read($path) === $service->all(), Flags::read($path));
