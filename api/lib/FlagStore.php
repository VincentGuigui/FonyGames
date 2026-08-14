<?php

declare(strict_types=1);

/**
 * Where flags are stored, behind an interface.
 * Spec: docs/specs/backoffice.md §2b
 *
 * MySQL is the source of truth, but the interface exists so the tests drive **real
 * SQL against SQLite in memory** rather than a hand-written fake. Both are PDO, so
 * the SQL in `PdoFlagStore` is the SQL that runs in production — a fake store would
 * have proved only that the fake works.
 *
 * The one thing that is *not* covered by that: the DDL. `db/init.sql` is MySQL and
 * the test schema is SQLite, so a MySQL-only syntax error would slip through here.
 * `docs/database.md` §4 already requires every migration to be proven against a
 * local MariaDB before it goes near the host, which is exactly the gap this leaves.
 */
interface FlagStore
{
    /**
     * Every flag, keyed by slug, sorted.
     *
     * @return array<string, array<string, mixed>>
     */
    public function load(): array;

    /**
     * Store one slug's final flag shape, and record the change.
     *
     * Takes the finished flag rather than a patch: `Flags::apply()` owns the merge,
     * so the store never has to know what a partial update means.
     *
     * @param array<string, mixed> $flag
     */
    public function put(string $slug, array $flag): void;

    /**
     * The change log, newest first. Bounded, because it is read into a page.
     *
     * @return list<array<string, mixed>>
     */
    public function history(int $limit = 50): array;

    /**
     * Finished rounds per slug, for the games that have any.
     *
     * Only non-zero counts: a zero is indistinguishable from "never played" to every
     * reader, and shipping it would put thirteen zeroes in a public file for nothing.
     *
     * @return array<string, int>
     */
    public function plays(): array;

    /** Count one finished round, returning the game's new total. */
    public function bump(string $slug): int;
}
