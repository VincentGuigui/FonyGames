<?php

declare(strict_types=1);

/**
 * The test database: SQLite in memory, with the same columns db/init.sql declares.
 * Docs: docs/testing.md §1.1a
 *
 * Real SQL through real PDO, so `PdoFlagStore`'s statements are the statements
 * production runs. A hand-written fake store would have proved only that the fake
 * works.
 *
 * ⚠️ **The DDL below is a translation, not the shipped schema.** `db/init.sql` is
 * MySQL — `ENGINE=InnoDB`, `TINYINT(1)`, `AUTO_INCREMENT` — none of which SQLite
 * accepts, so the two are written separately and can drift. What that means in
 * practice: a MySQL-only DDL error will pass here and fail on the host. That gap is
 * exactly why docs/database.md §4 rule 3 requires every migration to be proven
 * against a local MariaDB first; this file does not replace that and must not be read
 * as doing so.
 *
 * Column names and types-as-far-as-they-matter are kept identical by hand, and the
 * store's tests would fail loudly on a rename.
 */
function testDb(): PDO
{
    $db = new PDO('sqlite::memory:', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);

    $db->exec(
        'CREATE TABLE game_flags (
            slug         TEXT    NOT NULL PRIMARY KEY,
            availability TEXT    NOT NULL DEFAULT \'active\',
            is_new       INTEGER NOT NULL DEFAULT 0,
            reason       TEXT        NULL DEFAULT NULL,
            updated_at   INTEGER NOT NULL
        )',
    );

    $db->exec(
        'CREATE TABLE flag_audit (
            id           INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            slug         TEXT    NOT NULL,
            availability TEXT    NOT NULL,
            is_new       INTEGER NOT NULL DEFAULT 0,
            reason       TEXT        NULL DEFAULT NULL,
            at           INTEGER NOT NULL
        )',
    );

    return $db;
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
