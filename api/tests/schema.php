<?php

declare(strict_types=1);

/**
 * The test database: **real MariaDB, built from the real `db/init.sql`.**
 * Docs: docs/testing.md §1.1a · docs/database.md §4 rule 3, §5
 *
 * This used to be a hand-written SQLite translation of the schema, and that was a
 * documented hole: `db/init.sql` is MariaDB — `ENGINE=InnoDB`, `TINYINT(1)`,
 * `AUTO_INCREMENT`, `utf8mb4_unicode_ci` — none of which SQLite accepts, so the two were
 * maintained separately and a MariaDB-only DDL error would pass here and fail on the host.
 *
 * Now the suite applies the shipped file to a real server, so:
 *
 *  - the DDL that runs in the tests is the DDL that runs in production;
 *  - `PdoFlagStore` and `PdoAuthStore` meet MariaDB's actual type coercion, which is where
 *    the `(bool) (int)` reading of `TINYINT(1)` matters — SQLite hands back an int and
 *    MariaDB a string, and only one of those catches a bare `(bool)` cast;
 *  - `database.md` §4 rule 3 is satisfied by the test run rather than by a promise.
 *
 * ## Why it hard-fails instead of falling back to SQLite
 *
 * A silent fallback is how a guard rots: the suite would go green on a machine with no
 * server while proving nothing about the schema, which is the exact failure this change
 * exists to remove. So no server is an error with the command to fix it. CI gets a service
 * container (`.github/workflows/main.yml`).
 */

/** Every table `db/init.sql` creates. Truncated between tests, so the list must be exact. */
const TEST_TABLES = ['flag_audit', 'game_flags', 'admin_link', 'admin_link_attempt'];

/**
 * Where to connect.
 *
 * **`FONY_TEST_DSN`, when set, is the ONLY candidate.** An earlier version put it first in
 * a fallback list, and that was wrong in a way worth recording: pointing it at a dead port
 * made the suite quietly connect to a *different* server and pass — the same class of
 * silent substitution this whole change exists to remove. An explicit setting that fails
 * must fail.
 *
 * With nothing set, try TCP on the conventional port and then the Debian/Ubuntu socket,
 * which is what a locally-installed server offers and needs no password as root.
 *
 * @return list<array{dsn: string, user: string, pass: string}>
 */
function testDbCandidates(): array
{
    $env = getenv('FONY_TEST_DSN');
    $user = getenv('FONY_TEST_USER') ?: 'root';
    $pass = getenv('FONY_TEST_PASS') ?: '';

    if (is_string($env) && $env !== '') {
        return [['dsn' => $env, 'user' => $user, 'pass' => $pass]];
    }

    // `fonygames_test`, never `fonygames`. See the guard in testDbName().
    $suffix = ';dbname=fonygames_test;charset=utf8mb4';

    return [
        ['dsn' => 'mysql:host=127.0.0.1;port=3306' . $suffix, 'user' => $user, 'pass' => $pass],
        ['dsn' => 'mysql:unix_socket=/var/run/mysqld/mysqld.sock' . $suffix, 'user' => $user, 'pass' => $pass],
    ];
}

/**
 * The database name out of a DSN, and the safety rule that goes with it.
 *
 * **The suite TRUNCATEs every table it knows about**, so pointing `FONY_TEST_DSN` at a real
 * database would empty it. Refusing anything not ending in `_test` is cheap and is the one
 * mistake here that destroys data rather than failing a test.
 */
function testDbName(string $dsn): string
{
    preg_match('/dbname=([^;]+)/', $dsn, $m);
    $name = $m[1] ?? '';

    if (!str_ends_with($name, '_test')) {
        fwrite(STDERR, <<<TEXT

            REFUSING TO RUN. The test database is '{$name}'.

            This suite TRUNCATEs every table it knows about, so it only ever runs against a
            database whose name ends in `_test`. Point FONY_TEST_DSN at one.

            TEXT);
        exit(1);
    }

    return $name;
}

/**
 * The candidate that actually connected.
 *
 * Tests that build their own `App` need the WORKING connection, not
 * `testDbCandidates()[0]` — on a Debian box root authenticates by unix_socket, so the TCP
 * candidate fails and the suite falls through to the socket. A fixture that hardcoded [0]
 * connected to nothing and reported "the schema is not installed", which looks like a bug
 * in the code under test.
 *
 * @return array{dsn: string, user: string, pass: string}
 */
function testDbUsed(): array
{
    testDbConnection();

    /** @var array{dsn: string, user: string, pass: string}|null $used */
    $used = $GLOBALS['__fony_test_conn'] ?? null;
    if ($used === null) {
        fwrite(STDERR, "no working connection recorded\n");
        exit(1);
    }

    return $used;
}

/** Connect once per process, creating the database and schema on first use. */
function testDbConnection(): PDO
{
    static $db = null;
    if ($db !== null) {
        return $db;
    }

    $errors = [];
    foreach (testDbCandidates() as $candidate) {
        $name = testDbName($candidate['dsn']);

        try {
            // Connect WITHOUT the database first: it may not exist yet, and creating it is
            // part of the setup rather than something the operator has to remember.
            $serverDsn = (string) preg_replace('/;dbname=[^;]+/', '', $candidate['dsn']);
            $server = new PDO($serverDsn, $candidate['user'], $candidate['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 3,
            ]);
            $server->exec(
                "CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
            );

            $db = new PDO($candidate['dsn'], $candidate['user'], $candidate['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                // Real prepared statements, matching App::db() — emulation interpolates
                // client-side, which is a different code path from production's.
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);

            applyInitSql($db);
            $GLOBALS['__fony_test_conn'] = $candidate;

            return $db;
        } catch (Throwable $e) {
            $errors[] = $candidate['dsn'] . ' → ' . $e->getMessage();
        }
    }

    fwrite(STDERR, <<<TEXT

        NO MARIADB SERVER REACHABLE, so the schema-backed tests cannot run.

        docs/database.md §4 rule 3 makes MariaDB the test target: the shipped DDL is
        MariaDB and must be proven against MariaDB, not against a translation. There is
        deliberately no SQLite fallback — it would go green while proving nothing.

        Start one:
          docker run --rm -d --name fony-db -e MARIADB_ROOT_PASSWORD=dev \\
            -p 3306:3306 mariadb:11
          FONY_TEST_PASS=dev npm test

        or install it locally and set FONY_TEST_DSN / FONY_TEST_USER / FONY_TEST_PASS.

        Tried:
        TEXT);
    fwrite(STDERR, "\n  " . implode("\n  ", $errors) . "\n\n");
    exit(1);
}

/**
 * Apply the **shipped** `db/init.sql`.
 *
 * The whole point of this file. It is split on `;` by the same splitter the migration
 * runner uses, so the test setup and the production runner agree about what a statement is.
 */
function applyInitSql(PDO $db): void
{
    require_once __DIR__ . '/../lib/Migrator.php';

    $path = __DIR__ . '/../../db/init.sql';
    if (!is_readable($path)) {
        fwrite(STDERR, "db/init.sql is missing — nothing to build the test schema from\n");
        exit(1);
    }

    foreach (Migrator::statements((string) file_get_contents($path)) as $sql) {
        $db->exec($sql);
    }
}

/**
 * A clean database.
 *
 * Every caller used to get a brand-new in-memory SQLite, so tests are written expecting
 * isolation. One shared MariaDB database plus a truncate per call preserves that.
 *
 * `DELETE` rather than `TRUNCATE`: truncate is DDL in MariaDB and implicitly commits,
 * which would break a test that is mid-transaction, and it cannot run inside one at all.
 * `AUTO_INCREMENT` is reset explicitly, because two tests assert on row ordering by id.
 */
function testDb(): PDO
{
    $db = testDbConnection();

    // Off while truncating, so the order of the table list cannot matter. Restored
    // immediately — leaving it off would let a test insert a child row with no parent and
    // pass for the wrong reason.
    $db->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach (TEST_TABLES as $table) {
        $db->exec("DELETE FROM `{$table}`");
        $db->exec("ALTER TABLE `{$table}` AUTO_INCREMENT = 1");
    }
    $db->exec('SET FOREIGN_KEY_CHECKS = 1');

    return $db;
}

/**
 * A second, independent database, for comparing schemas.
 *
 * Used by `migrator_test.php` to prove that applying every migration to an empty database
 * lands on the same schema as running `init.sql` — an invariant `0001_flags.sql` asserts in
 * a comment and nothing checked until now.
 */
function testDbSecond(string $suffix = 'alt'): PDO
{
    $name = "fonygames_{$suffix}_test";
    $primary = testDbConnection();
    $primary->exec("DROP DATABASE IF EXISTS `{$name}`");
    $primary->exec("CREATE DATABASE `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    foreach (testDbCandidates() as $candidate) {
        $dsn = (string) preg_replace('/dbname=[^;]+/', "dbname={$name}", $candidate['dsn']);
        try {
            return new PDO($dsn, $candidate['user'], $candidate['pass'], [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (Throwable) {
            // Try the next candidate; the primary connection already proved one works.
            continue;
        }
    }

    fwrite(STDERR, "could not open the second test database\n");
    exit(1);
}

/**
 * Every column of a database, as a comparable string.
 *
 * `information_schema` rather than `SHOW CREATE TABLE`, because the latter includes the
 * AUTO_INCREMENT counter and other state that differs between two databases holding the
 * same schema.
 */
function schemaFingerprint(PDO $db, string $dbName): string
{
    $stmt = $db->prepare(
        'SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION',
    );
    $stmt->execute([$dbName]);

    $lines = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $lines[] = implode('|', array_map(static fn ($v): string => (string) $v, $row));
    }

    return implode("\n", $lines);
}

/** A scratch directory that cleans itself up, for the publish tests. */
function tempDir(string $prefix = 'fony'): string
{
    $base = sys_get_temp_dir() . '/' . $prefix . '-' . bin2hex(random_bytes(6));
    mkdir($base, 0755, true);

    register_shutdown_function(static function () use ($base): void {
        foreach (glob($base . '/{,.}*', GLOB_BRACE) ?: [] as $f) {
            if (is_file($f)) {
                @unlink($f);
            }
        }
        @rmdir($base);
    });

    return $base;
}
