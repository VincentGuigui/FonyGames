<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once dirname(__DIR__) . '/lib/Analytics.php';

/**
 * Activity events: what gets recorded, and what must never be.
 * Implementation: api/lib/Analytics.php · Spec: docs/specs/analytics.md
 *
 * This is the one table in the schema that holds anything about a person, so the checks
 * below are weighted towards the promises rather than the plumbing:
 *
 *  - **there is no column for the IP**, asserted against the real schema rather than by
 *    reading the code, because that is the promise the spec makes to players and a
 *    future `ALTER TABLE` is exactly how it would be broken;
 *  - the timestamp is the SERVER's, so a phone with a wrong clock cannot lie about when;
 *  - the action vocabulary is closed, so this endpoint cannot invent kinds of event;
 *  - a geolocation failure is a row with NULL geography, not a lost event.
 */

/** A geolocator that answers whatever the test wants, and counts how often it was asked. */
final class FakeGeolocator implements Geolocator
{
    public int $calls = 0;

    /** @var list<string> Every address it was handed, so a test can assert what leaked. */
    public array $seen = [];

    public function __construct(
        private ?string $city = 'Paris',
        private ?string $country = 'FR',
    ) {
    }

    public function locate(string $ip): array
    {
        $this->calls++;
        $this->seen[] = $ip;

        return ['city' => $this->city, 'country' => $this->country];
    }
}

/** Every row, oldest first. */
function analyticsRows(PDO $db): array
{
    return $db->query('SELECT * FROM analytics_event ORDER BY id')->fetchAll(PDO::FETCH_ASSOC);
}

group('the events table has nowhere to put an IP address');

{
    $db = testDb();
    $columns = array_column(
        $db->query('SHOW COLUMNS FROM analytics_event')->fetchAll(PDO::FETCH_ASSOC),
        'Field',
    );
    sort($columns);

    check('the columns are exactly the agreed set', $columns === [
        'action', 'at', 'city', 'country', 'id', 'nickname', 'object', 'referrer', 'visitor_id',
    ], $columns);

    /*
     * Named individually rather than trusting the set comparison above, because this is
     * the assertion someone adding a column would have to delete on purpose.
     */
    foreach (['ip', 'ip_address', 'ip_hash', 'remote_addr', 'address'] as $forbidden) {
        check("there is no {$forbidden} column", !in_array($forbidden, $columns, true));
    }
}

group('the action vocabulary is closed');

{
    check('a known action passes', Analytics::action('game_start') === 'game_start');
    check('every documented action is accepted', array_map(
        static fn (string $a): ?string => Analytics::action($a),
        Analytics::ACTIONS,
    ) === Analytics::ACTIONS);
    check('an invented one does not', Analytics::action('steal_data') === null);
    check('nor does the empty string', Analytics::action('') === null);
    check('nor a non-string', Analytics::action(['game_start']) === null);
    // The six the client is written against. A seventh is a deliberate change to both.
    check('there are six of them', count(Analytics::ACTIONS) === 6, Analytics::ACTIONS);
}

group('a request is parsed into a row, or refused');

{
    $ok = Analytics::parse(['action' => 'game_select', 'object' => 'grid-attack']);
    check('a good body is accepted', $ok['ok'] === true);
    check('with its action', $ok['action'] === 'game_select');
    check('and its object', $ok['object'] === 'grid-attack');
    check('referrer and nickname default to null', $ok['referrer'] === null && $ok['nickname'] === null);

    check('an unknown action is refused', Analytics::parse(['action' => 'nope'])['ok'] === false);
    check('a missing action is refused', Analytics::parse([])['ok'] === false);
    check('and a null body is', Analytics::parse(null)['ok'] === false);

    // An object is optional — `hub_nav` has nothing to point at.
    $bare = Analytics::parse(['action' => 'hub_nav']);
    check('an action with no object is fine', $bare['ok'] === true && $bare['object'] === null);
    check('and an empty-string object reads as none', Analytics::parse(
        ['action' => 'hub_nav', 'object' => ''],
    )['object'] === null);

    /*
     * Refused rather than nulled. A malformed object means the caller and this endpoint
     * disagree about what happened, and recording the event anyway would file it against
     * the wrong thing.
     */
    check('a malformed object is refused', Analytics::parse(
        ['action' => 'game_select', 'object' => 'Grid Attack!'],
    )['ok'] === false);
    check('and so is one that is not a string', Analytics::parse(
        ['action' => 'game_select', 'object' => 42],
    )['ok'] === false);
}

group('strings are trimmed to fit their columns rather than losing the event');

{
    check('a long nickname is cut, not rejected', Analytics::text(str_repeat('a', 50), 20) === str_repeat('a', 20));
    check('whitespace is collapsed', Analytics::text("  Vincent   Guigui \n", 20) === 'Vincent Guigui');
    check('blank becomes null', Analytics::text('   ', 20) === null);
    check('a non-string becomes null', Analytics::text(42, 20) === null);

    /*
     * Multi-byte, because cutting a UTF-8 name mid-codepoint produces bytes MySQL
     * rejects on a utf8mb4 column — which would turn a long accented name into a 500.
     */
    $accented = Analytics::text(str_repeat('é', 40), 20);
    check('a multi-byte name is cut by characters', mb_strlen((string) $accented) === 20);
    check('and stays valid UTF-8', mb_check_encoding((string) $accented, 'UTF-8'));

    $parsed = Analytics::parse([
        'action' => 'room_join',
        'referrer' => 'https://example.com/' . str_repeat('x', 400),
    ]);
    check('a long referrer fits its column', strlen((string) $parsed['referrer']) === 255);
}

group('the visitor id is minted here, never taken on trust');

{
    $fresh = Analytics::visitor(null);
    check('no cookie means a new id', $fresh['fresh'] === true);
    check('and it is a v4 UUID', preg_match(
        '/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/D',
        $fresh['id'],
    ) === 1, $fresh['id']);

    $kept = Analytics::visitor('123e4567-e89b-42d3-a456-426614174000');
    check('a well-formed cookie is kept', $kept['fresh'] === false);
    check('unchanged', $kept['id'] === '123e4567-e89b-42d3-a456-426614174000');

    /*
     * The cookie is attacker-controlled and lands in a CHAR(36) column that the rate
     * limit is keyed on, so anything not shaped like a UUID is replaced rather than
     * stored. Replaced, not refused: a mangled cookie costs that visitor their history
     * and nothing else.
     */
    foreach ([
        'not-a-uuid',
        "' OR 1=1 --",
        str_repeat('a', 200),
        '123e4567e89b42d3a456426614174000',
        '123E4567-E89B-42D3-A456-426614174000',
    ] as $bad) {
        $out = Analytics::visitor($bad);
        check('a bad cookie is replaced: ' . substr($bad, 0, 18), $out['fresh'] === true && $out['id'] !== $bad);
    }

    // Two ids in a row must differ, or "unique visitor" means nothing.
    check('ids are not repeated', Analytics::uuid4() !== Analytics::uuid4());
}

group('recording an event stores the geography and drops the address');

{
    $db = testDb();
    $clock = new FakeClock(1_700_000_000_000);
    $geo = new FakeGeolocator('Paris', 'FR');
    $analytics = new Analytics($db, $clock, $geo);

    $result = $analytics->record('123e4567-e89b-42d3-a456-426614174000', 'game_start', 'grid-attack', null, 'Vincent', '81.2.69.142');

    $rows = analyticsRows($db);
    check('one row was written', count($rows) === 1);
    check('with the server clock, not the client', (int) $rows[0]['at'] === 1_700_000_000_000);
    check('and the reported time matches it', $result['at'] === 1_700_000_000_000);
    check('the action is stored', $rows[0]['action'] === 'game_start');
    check('the object is stored', $rows[0]['object'] === 'grid-attack');
    check('the nickname is stored', $rows[0]['nickname'] === 'Vincent');
    check('the city came from the geolocator', $rows[0]['city'] === 'Paris');
    check('and the country', $rows[0]['country'] === 'FR');
    check('the geolocator was asked once', $geo->calls === 1);
    check('and it was given the address', $geo->seen === ['81.2.69.142']);

    /*
     * The whole point, asserted against the stored row: the address was used and is not
     * anywhere in what was kept.
     */
    check('the address is in no column', !in_array('81.2.69.142', array_map('strval', array_values($rows[0])), true));
    check('and not in the row as a substring', !str_contains(implode('|', array_map('strval', array_values($rows[0]))), '81.2.69'));
}

group('a geolocation that fails still records the event');

{
    $db = testDb();
    $analytics = new Analytics($db, new FakeClock(), new FakeGeolocator(null, null));

    $analytics->record(Analytics::uuid4(), 'hub_nav', null, null, null, '81.2.69.142');

    $rows = analyticsRows($db);
    check('the event is there', count($rows) === 1);
    check('with no city', $rows[0]['city'] === null);
    check('and no country', $rows[0]['country'] === null);
    check('and the nullable columns are null, not empty strings', $rows[0]['nickname'] === null && $rows[0]['referrer'] === null && $rows[0]['object'] === null);
}

group('an unconfigured host makes no lookups at all');

{
    $none = new NoGeolocator();
    check('and reports nothing known', $none->locate('81.2.69.142') === ['city' => null, 'country' => null]);
}

group('the per-visitor rate limit bounds an accident');

{
    $db = testDb();
    $clock = new FakeClock(1_700_000_000_000);
    $analytics = new Analytics($db, $clock, new FakeGeolocator());
    $me = Analytics::uuid4();
    $someoneElse = Analytics::uuid4();

    check('a fresh visitor is not throttled', $analytics->throttled($me) === false);

    for ($i = 0; $i < Analytics::RATE_LIMIT; $i++) {
        $analytics->record($me, 'hub_nav', null, null, null, '');
    }

    check('at the ceiling they are', $analytics->throttled($me) === true);
    // Per visitor, not global: one looping phone must not stop the rest of the table.
    check('but somebody else is not', $analytics->throttled($someoneElse) === false);

    // The window slides, so a throttled visitor recovers rather than being banned.
    $clock->advance(Analytics::RATE_WINDOW_MS + 1);
    check('and once the window passes, nor are they', $analytics->throttled($me) === false);
}

group('the caller address is read from the proxy headers, and validated');

{
    check('Cloudflare first', Analytics::callerIp([
        'HTTP_CF_CONNECTING_IP' => '81.2.69.142',
        'REMOTE_ADDR' => '10.0.0.1',
    ]) === '81.2.69.142');

    check('then X-Forwarded-For, whose FIRST entry is the client', Analytics::callerIp([
        'HTTP_X_FORWARDED_FOR' => '81.2.69.142, 10.0.0.1, 10.0.0.2',
        'REMOTE_ADDR' => '10.0.0.1',
    ]) === '81.2.69.142');

    check('REMOTE_ADDR last', Analytics::callerIp(['REMOTE_ADDR' => '81.2.69.142']) === '81.2.69.142');

    // Garbage in a client-supplied header must not reach curl or the geolocator.
    check('a junk header is skipped', Analytics::callerIp([
        'HTTP_CF_CONNECTING_IP' => 'not-an-ip',
        'REMOTE_ADDR' => '81.2.69.142',
    ]) === '81.2.69.142');
    check('nothing usable is the empty string', Analytics::callerIp([]) === '');
    check('and so is a header full of nonsense', Analytics::callerIp(['REMOTE_ADDR' => '; rm -rf /']) === '');
    check('IPv6 is an address too', Analytics::callerIp(
        ['REMOTE_ADDR' => '2001:db8::1'],
    ) === '2001:db8::1');
}

group('the endpoint and the client agree on the vocabulary');

{
    /*
     * The six action strings live in two files that are never edited together — this
     * allowlist and `www/src/core/analytics.ts`. A rename on one side is a silently
     * dropped event, which is the same failure `config_test.php` exists to catch for
     * config keys, so it gets the same treatment: read the other file as text.
     */
    $client = file_get_contents(dirname(__DIR__, 2) . '/www/src/core/analytics.ts');
    check('the client module is readable', is_string($client) && $client !== '');

    foreach (Analytics::ACTIONS as $action) {
        check("the client knows '{$action}'", str_contains((string) $client, "'{$action}'"));
    }

    // And the endpoint the client posts to is the one that exists.
    check('the client posts to /api/analytics', str_contains((string) $client, '/api/analytics'));
}

group('summary(): the dashboard, in counts — never a list of what one visitor did');

{
    $db = testDb();
    $clock = new FakeClock(1_700_000_000_000);
    $analytics = new Analytics($db, $clock, new FakeGeolocator());

    $day = 86_400_000;

    // Inside the window: two hub visits, a select, a create, a join, a start and a
    // played, spread across two games and two cities.
    $analytics->record('11111111-1111-4111-8111-111111111111', 'hub_nav', null, null, null, '1.2.3.4');
    $analytics->record('11111111-1111-4111-8111-111111111111', 'game_select', 'grid-attack', null, null, '1.2.3.4');
    $analytics->record('11111111-1111-4111-8111-111111111111', 'room_create', 'grid-attack', null, null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'hub_nav', null, 'https://example.com/party', null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'game_select', 'spill', null, null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'room_join', 'spill', null, null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'game_start', 'spill', null, null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'game_played', 'spill', null, null, '1.2.3.4');
    $analytics->record('22222222-2222-4222-8222-222222222222', 'game_played', 'spill', null, null, '1.2.3.4');

    // Outside the window: must not be counted at all.
    $clock->advance(-8 * $day);
    $analytics->record('33333333-3333-4333-8333-333333333333', 'hub_nav', null, null, null, '1.2.3.4');
    $clock->advance(8 * $day);

    $summary = $analytics->summary(7);

    check('the window is the days asked for', $summary['windowDays'] === 7);
    check('since is 7 days before now', $summary['since'] === 1_700_000_000_000 - 7 * $day);

    check('hub_nav counted twice, the old one excluded', $summary['totals']['hub_nav'] === 2);
    check('game_select counted twice', $summary['totals']['game_select'] === 2);
    check('room_create counted once', $summary['totals']['room_create'] === 1);
    check('room_join counted once', $summary['totals']['room_join'] === 1);
    check('game_start counted once', $summary['totals']['game_start'] === 1);
    check('game_played counted twice', $summary['totals']['game_played'] === 2);
    check('every action is present even at zero', array_keys($summary['totals']) === Analytics::ACTIONS);

    check('two distinct visitors, not nine events', $summary['uniqueVisitors'] === 2);

    check('two games appear', count($summary['topGames']) === 2);
    $spill = null;
    $grid = null;
    foreach ($summary['topGames'] as $row) {
        if ($row['slug'] === 'spill') {
            $spill = $row;
        }
        if ($row['slug'] === 'grid-attack') {
            $grid = $row;
        }
    }
    check('spill is there', $spill !== null);
    check('with its own counts, not summed across games', $spill['gamePlayed'] === 2 && $spill['gameStart'] === 1);
    check('grid-attack has no plays', $grid !== null && $grid['gamePlayed'] === 0 && $grid['roomCreate'] === 1);
    check('spill outranks grid-attack by plays', $summary['topGames'][0]['slug'] === 'spill');

    check('one country, from the geolocator', $summary['countries'] === [['country' => 'FR', 'count' => 9]]);
    check('one city, same reason', $summary['cities'] === [['city' => 'Paris', 'count' => 9]]);

    check('the referrer is grouped by host, not the full URL', $summary['referrers'] === [
        ['host' => 'example.com', 'count' => 1],
    ]);
}

group('summary(): a real referrer never leaks a raw address, and the window clamps');

{
    $db = testDb();
    $analytics = new Analytics($db, new FakeClock(), new FakeGeolocator(null, null));

    check('zero days is not zero rows', $analytics->summary(0)['windowDays'] >= 1);
    check(
        'an absurd window is capped',
        $analytics->summary(100_000)['windowDays'] === Analytics::SUMMARY_MAX_DAYS,
    );

    check('an empty table answers zeroes, not an error', array_sum($analytics->summary(7)['totals']) === 0);
    check('and no visitors', $analytics->summary(7)['uniqueVisitors'] === 0);
    check('and no games', $analytics->summary(7)['topGames'] === []);
}
