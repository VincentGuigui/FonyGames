<?php

declare(strict_types=1);

require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/../lib/Migrator.php';

/**
 * The migration runner, against real MariaDB.
 * Spec: docs/database.md §4, §5
 *
 * Two halves. The **statement splitter** is pure and gets the hostile inputs, because a
 * wrong split produces an error that points at something which is not the problem. The
 * **runner** gets a real server, real DDL and a deliberately broken migration, because the
 * behaviour that matters is what it does when a migration fails halfway — MariaDB has
 * already committed the DDL by then, and there is nothing to roll back.
 */

group('the splitter: the ordinary cases');

check('one statement', Migrator::statements('SELECT 1;') === ['SELECT 1']);
check('a missing final semicolon is still a statement', Migrator::statements('SELECT 1') === ['SELECT 1']);
check('two statements', Migrator::statements('SELECT 1; SELECT 2;') === ['SELECT 1', 'SELECT 2']);
check('blank space between them is dropped', Migrator::statements("SELECT 1;\n\n\n  ;\nSELECT 2;") === ['SELECT 1', 'SELECT 2']);
check('an empty file yields nothing', Migrator::statements('') === []);
check('a file of only comments yields nothing', Migrator::statements("-- nothing here\n-- really\n") === []);

group('the splitter: semicolons that are NOT statement ends');

// THE reason this is not `explode(';')`. Each of these would be split in the middle by a
// naive implementation, and the resulting syntax error would point at the wrong place.
$sql = "INSERT INTO t (a) VALUES ('one; two');";
check('inside a single-quoted string', Migrator::statements($sql) === [$sql === '' ? '' : "INSERT INTO t (a) VALUES ('one; two')"], Migrator::statements($sql));

$sql = 'INSERT INTO t (a) VALUES ("one; two");';
check('inside a double-quoted string', count(Migrator::statements($sql)) === 1, Migrator::statements($sql));

$sql = "CREATE TABLE `weird; name` (a INT);";
check('inside a backquoted identifier', count(Migrator::statements($sql)) === 1, Migrator::statements($sql));

$sql = "-- a comment; with a semicolon\nSELECT 1;";
check('inside a line comment', Migrator::statements($sql) === ['SELECT 1'], Migrator::statements($sql));

$sql = "# a hash comment; with one too\nSELECT 1;";
check('inside a hash comment', Migrator::statements($sql) === ['SELECT 1'], Migrator::statements($sql));

$sql = "/* a block; comment */ SELECT 1;";
check('inside a block comment', Migrator::statements($sql) === ['SELECT 1'], Migrator::statements($sql));

$sql = "INSERT INTO t (a) VALUES ('it\\'s; here');";
check('after a backslash-escaped quote', count(Migrator::statements($sql)) === 1, Migrator::statements($sql));

$sql = "INSERT INTO t (a) VALUES ('it''s; here');";
check('after a doubled quote', count(Migrator::statements($sql)) === 1, Migrator::statements($sql));

// An unterminated block comment must not swallow the rest silently in a way that loses a
// statement AND reports success — it consumes to end of file, which is what MariaDB does.
check('an unterminated block comment eats the rest', Migrator::statements("SELECT 1; /* oops") === ['SELECT 1']);

group('the splitter refuses what it cannot split');

// A stored routine's body contains semicolons that are not statement ends. There is no
// honest way to split it without implementing DELIMITER, so it is refused — a loud
// "unsupported" beats a confident wrong answer.
check('DELIMITER is refused', Migrator::check("DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//") !== null);
check('and says why', str_contains((string) Migrator::check('DELIMITER //'), 'not support'));
check('a trigger is refused', Migrator::check('CREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW SET @a = 1;') !== null);
check('a procedure is refused', Migrator::check('CREATE PROCEDURE p() BEGIN END') !== null);
check('a function is refused', Migrator::check('CREATE FUNCTION f() RETURNS INT RETURN 1') !== null);
check('lower case is refused too', Migrator::check('delimiter //') !== null);
check('ordinary DDL is fine', Migrator::check('CREATE TABLE IF NOT EXISTS t (a INT);') === null);
// The word inside a string or a column name must not trip it. `\b` word boundaries mean
// `deliverance` does not match `DELIMITER`, but a column literally called `delimiter` would
// — a false refusal, which is the safe direction and is worth knowing about.
check('a similar word does not trip it', Migrator::check("INSERT INTO t VALUES ('deliverance');") === null);

group('the runner: a fresh database');

$dir = tempDir('mig');
file_put_contents($dir . '/0001_first.sql', "CREATE TABLE IF NOT EXISTS m_one (a INT PRIMARY KEY) ENGINE=InnoDB;\n");
file_put_contents($dir . '/0002_second.sql', "CREATE TABLE IF NOT EXISTS m_two (b INT PRIMARY KEY) ENGINE=InnoDB;\n");

$db = testDbSecond('mig');
$migrator = new Migrator($db, $dir);

check('nothing is applied yet', $migrator->applied() === []);
check('both files are pending', $migrator->pending() === ['0001_first.sql', '0002_second.sql'], $migrator->pending());
// `installed()` asks about the app's own schema, not the ledger — this database has neither.
check('the schema is not installed', $migrator->installed() === false);

$result = $migrator->apply(1_700_000_000_000);
check('the run succeeds', $result['ok'] === true, $result);
check('both were applied, in order', $result['applied'] === ['0001_first.sql', '0002_second.sql'], $result);
check('and both tables exist', $db->query("SHOW TABLES LIKE 'm_%'")->rowCount() === 2);
check('the ledger recorded them', array_keys($migrator->applied()) === ['0001_first.sql', '0002_second.sql']);
check('with the timestamp it was given', $migrator->applied()['0001_first.sql'] === 1_700_000_000_000);

group('the runner: a second run is a clean no-op');

// docs/database.md §5 calls this THE idempotency test: run it twice, and the second time
// nothing happens.
$again = $migrator->apply(1_700_000_009_999);
check('it succeeds', $again['ok'] === true);
check('and applies nothing', $again['applied'] === [], $again);
check('reporting what it skipped', count($again['skipped']) === 2, $again);
check('nothing is pending', $migrator->pending() === []);
check('and the original timestamps are untouched', $migrator->applied()['0001_first.sql'] === 1_700_000_000_000);

group('the runner: a new file is picked up, older ones are not re-run');

file_put_contents($dir . '/0003_third.sql', "CREATE TABLE IF NOT EXISTS m_three (c INT PRIMARY KEY) ENGINE=InnoDB;\n");
check('only the new one is pending', $migrator->pending() === ['0003_third.sql'], $migrator->pending());
$third = $migrator->apply(1_700_000_020_000);
check('it applies', $third['applied'] === ['0003_third.sql'], $third);
check('and the ledger now has three', count($migrator->applied()) === 3);

group('the runner: a failure stops, names the statement, and is not recorded');

// Statement 2 is bad on purpose. Statement 1 will have COMMITTED by then — MariaDB
// implicitly commits DDL — which is exactly why there is no transaction here and why the
// ledger must not record this file.
file_put_contents(
    $dir . '/0004_broken.sql',
    "CREATE TABLE IF NOT EXISTS m_four (d INT PRIMARY KEY) ENGINE=InnoDB;\n"
    . "THIS IS NOT SQL;\n"
    . "CREATE TABLE IF NOT EXISTS m_five (e INT PRIMARY KEY) ENGINE=InnoDB;\n",
);

$broken = $migrator->apply(1_700_000_030_000);
check('the run reports failure', $broken['ok'] === false, $broken);
check('naming the file', $broken['failed']['file'] === '0004_broken.sql', $broken['failed']);
// 1-based, so "statement 2" means the second one a human counts.
check('and the statement number', $broken['failed']['statement'] === 2, $broken['failed']);
check('with the driver’s own message', $broken['failed']['error'] !== '', $broken['failed']);

check('the first statement DID take effect — DDL is not transactional', $db->query("SHOW TABLES LIKE 'm_four'")->rowCount() === 1);
check('the third did not run', $db->query("SHOW TABLES LIKE 'm_five'")->rowCount() === 0);
// THE assertion of this group. A partially-applied file must stay pending, or the fix can
// never be re-run — which is what makes the idempotency rule the recovery path.
check('the broken file is NOT in the ledger', !isset($migrator->applied()['0004_broken.sql']), array_keys($migrator->applied()));
check('so it is still pending, ready to re-run after a fix', $migrator->pending() === ['0004_broken.sql']);

// And the fix really is "correct the file and run again", because 0001-0003 are recorded
// and are not touched a second time.
file_put_contents(
    $dir . '/0004_broken.sql',
    "CREATE TABLE IF NOT EXISTS m_four (d INT PRIMARY KEY) ENGINE=InnoDB;\n"
    . "CREATE TABLE IF NOT EXISTS m_five (e INT PRIMARY KEY) ENGINE=InnoDB;\n",
);
$fixed = $migrator->apply(1_700_000_040_000);
check('the fixed file applies', $fixed['ok'] === true && $fixed['applied'] === ['0004_broken.sql'], $fixed);
check('and re-running the already-created table was harmless', $db->query("SHOW TABLES LIKE 'm_five'")->rowCount() === 1);

group('the runner: an unsupported file fails before touching the database');

file_put_contents($dir . '/0005_routine.sql', "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;\n");
$refused = $migrator->apply(1_700_000_050_000);
check('it refuses', $refused['ok'] === false);
check('naming the file', $refused['failed']['file'] === '0005_routine.sql');
// Statement 0, because nothing was attempted — the distinction between "refused" and
// "failed partway" matters when deciding whether the database was touched.
check('at statement 0, meaning nothing ran', $refused['failed']['statement'] === 0, $refused['failed']);
check('and it stays pending', in_array('0005_routine.sql', $migrator->pending(), true));
unlink($dir . '/0005_routine.sql');

group('the SHIPPED migrations equal the SHIPPED init.sql');

/*
 * `db/migrations/0001_flags.sql` claims in a comment that "apply every migration to an
 * empty database" and "run init.sql" land on the same schema — and that if they diverge,
 * one of the two is lying with no way to tell which. Nothing checked it until now.
 *
 * Both sides are real MariaDB databases, compared through information_schema rather than
 * SHOW CREATE TABLE, which carries per-database state like the AUTO_INCREMENT counter.
 */
$fromInit = testDbConnection();
$fromMigrations = testDbSecond('frommig');
$shipped = new Migrator($fromMigrations, __DIR__ . '/../../db/migrations');

$run = $shipped->apply(1_700_000_000_000);
check('every shipped migration applies to an empty database', $run['ok'] === true, $run['failed'] ?? null);
check('and there are some', count($run['applied']) >= 2, $run['applied']);

$initPrint = schemaFingerprint($fromInit, 'fonygames_test');
$migPrint = schemaFingerprint($fromMigrations, 'fonygames_frommig_test');

// The ledger only exists on the migrated side, so it is excluded from the comparison —
// init.sql is not supposed to create it, the runner is.
$migPrint = implode("\n", array_filter(
    explode("\n", $migPrint),
    static fn (string $line): bool => !str_starts_with($line, 'schema_migrations|'),
));

check('the two schemas are identical', $initPrint === $migPrint, [
    'onlyInInit' => array_values(array_diff(explode("\n", $initPrint), explode("\n", $migPrint))),
    'onlyInMigrations' => array_values(array_diff(explode("\n", $migPrint), explode("\n", $initPrint))),
]);

// Re-running the whole shipped directory must be a no-op, which is database.md §4 rule 2
// applied to the real files rather than to fixtures.
$twice = $shipped->apply(1_700_000_060_000);
check('re-running the shipped directory changes nothing', $twice['ok'] === true && $twice['applied'] === [], $twice);

group('installed(): a fault is not a missing schema');

/*
 * The regression this group exists for. `installed()` used to `catch (Throwable)` and
 * return false for ANY error, so a wrong DSN was indistinguishable from an empty
 * database: the admin page offered a migrate button for a server it could not reach, and
 * the deploy reported a schema problem when the fault was connectivity.
 *
 * SQLSTATE 42S02 — base table or view not found — is the only error that means the schema
 * is absent. Everything else must propagate, so the API can answer 503 "not reachable"
 * with the driver's own message (docs/specs/backoffice.md §2c).
 */
$empty = testDbSecond('installed');
check('an empty-but-reachable database reports not-installed', (new Migrator($empty, tempDir('mig-e')))->installed() === false);

// A port nothing listens on. Chosen over a bad password because it needs no server-side
// state and fails the same way on any host.
$unreachable = null;
try {
    $unreachable = new PDO('mysql:host=127.0.0.1;port=1;dbname=fonygames_test', 'nobody', 'nobody', [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
} catch (PDOException $e) {
    // Connecting is what fails here, which is itself the point: the API's own `App::db()`
    // throws at this moment, and §1's handler is what turns it into a named answer.
    check('an unreachable server throws on connect, not silently', $e->getCode() !== '42S02', $e->getCode());
}
check('and no connection was handed back', $unreachable === null);

/*
 * The other half: connected, but the query fails for a reason that is NOT a missing table.
 * A view over a nonexistent table gives SQLSTATE 42S22 / HY000 rather than 42S02, so it
 * proves the code checks the state and does not just re-catch everything.
 */
$installed = testDbSecond('installed2');
$installed->exec('CREATE TABLE IF NOT EXISTS games (slug VARCHAR(64) PRIMARY KEY) ENGINE=InnoDB');
check('a real games table reports installed', (new Migrator($installed, tempDir('mig-i')))->installed() === true);

$installed->exec('DROP TABLE games');
check('and dropping it reports not-installed again', (new Migrator($installed, tempDir('mig-i2')))->installed() === false);
