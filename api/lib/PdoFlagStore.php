<?php

declare(strict_types=1);

require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/FlagStore.php';
require_once __DIR__ . '/Flags.php';

/**
 * The real flag store: two tables, over PDO.
 * Spec: docs/specs/backoffice.md §2b, §7 · Schema: db/init.sql
 *
 * ## The table is `games`, not `game_flags`
 *
 * It stopped being only about flags when it gained `plays`: one row per game, carrying
 * both what the operator decided and what the players did. `db/migrations/0003_games.sql`
 * renames it in place, so the counts and flags of an existing host survive.
 *
 * ## Why the SQL is boring on purpose
 *
 * No `ON DUPLICATE KEY UPDATE` (MySQL) and no `ON CONFLICT` (SQLite) — those two
 * spellings of upsert are not interchangeable, and picking one would mean the tests
 * exercise a different statement from production. A `SELECT`, then an `UPDATE` or an
 * `INSERT`, inside a transaction, is valid in both. Flags change a few times a year;
 * there is no performance argument on the other side of that trade.
 *
 * ## The audit row is written in the same transaction as the flag
 *
 * Not for tidiness: a flag that changed with no audit row is a lie about the history,
 * and an audit row for a change that did not land is worse. One transaction makes
 * both impossible.
 *
 * ## The column is still called `availability`
 *
 * `GameFlag.state` (shared/flags.ts) replaced the old `availability`/`isNew` pair with
 * one four-value field, but the column itself did not need to move: `VARCHAR(16)`
 * already held any string this code decided to put there (db/init.sql's own comment
 * says as much), so widening its meaning is a code change, not a schema one. Renaming
 * the column would have bought nothing but churn.
 */
final class PdoFlagStore implements FlagStore
{
    public function __construct(
        private PDO $db,
        private Clock $clock,
    ) {
        // Exceptions rather than silent false returns. A store that fails quietly
        // would publish a stale flags.json and report success.
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    public function load(): array
    {
        $rows = $this->db
            ->query('SELECT slug, availability, reason FROM games ORDER BY slug')
            ->fetchAll(PDO::FETCH_ASSOC);

        $out = [];
        foreach ($rows as $row) {
            $slug = Flags::slug((string) $row['slug']);
            if ($slug === null) {
                // A slug that fails the guard cannot have come through `put()`.
                // Skipped rather than trusted, because it reaches a URL.
                continue;
            }

            $flag = [
                'state' => in_array($row['availability'], Flags::STATES, true)
                    ? (string) $row['availability']
                    // A value outside the enum means the column drifted from the
                    // code. Fail open, like everything else about flags.
                    : Flags::ACTIVE,
            ];

            $reason = $row['reason'];
            if (is_string($reason) && trim($reason) !== '') {
                $flag['reason'] = trim($reason);
            }

            $out[$slug] = $flag;
        }

        return $out;
    }

    public function put(string $slug, array $flag): void
    {
        if (Flags::slug($slug) === null) {
            throw new InvalidArgumentException("refusing to store a bad slug: {$slug}");
        }

        $state = in_array($flag['state'] ?? null, Flags::STATES, true)
            ? (string) $flag['state']
            : Flags::ACTIVE;
        $reason = isset($flag['reason']) && is_string($flag['reason']) && trim($flag['reason']) !== ''
            ? mb_substr(trim($flag['reason']), 0, Flags::REASON_MAX)
            : null;
        $at = $this->clock->now();

        $this->db->beginTransaction();

        try {
            $exists = $this->db->prepare('SELECT 1 FROM games WHERE slug = ?');
            $exists->execute([$slug]);

            if ($exists->fetchColumn() === false) {
                $this->db
                    ->prepare(
                        'INSERT INTO games (slug, availability, reason, updated_at)
                         VALUES (?, ?, ?, ?)',
                    )
                    ->execute([$slug, $state, $reason, $at]);
            } else {
                $this->db
                    ->prepare(
                        'UPDATE games
                            SET availability = ?, reason = ?, updated_at = ?
                          WHERE slug = ?',
                    )
                    ->execute([$state, $reason, $at, $slug]);
            }

            $this->db
                ->prepare(
                    'INSERT INTO flag_audit (slug, availability, reason, at)
                     VALUES (?, ?, ?, ?)',
                )
                ->execute([$slug, $state, $reason, $at]);

            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();

            throw $e;
        }
    }

    public function plays(): array
    {
        $rows = $this->db
            ->query('SELECT slug, plays FROM games WHERE plays > 0 ORDER BY slug')
            ->fetchAll(PDO::FETCH_ASSOC);

        $out = [];
        foreach ($rows as $row) {
            $slug = Flags::slug((string) $row['slug']);
            if ($slug === null) {
                continue;
            }
            $out[$slug] = (int) $row['plays'];
        }

        return $out;
    }

    /**
     * One more finished round for this game.
     *
     * `UPDATE ... SET plays = plays + 1` rather than read-modify-write, so two rooms
     * finishing at the same instant score two: the increment happens in the server, and
     * a `SELECT` followed by a `SET plays = ?` would lose one of them.
     *
     * A slug with no row yet gets one — the first round a game is ever played is the row's
     * reason to exist, and requiring the operator to touch a flag first would mean a host
     * that never opened the admin centre could never count anything. It is created with
     * default flags, which is what an absent row already means (`Flags::default()`).
     *
     * The INSERT is attempted first and a duplicate key is *expected*: it is the race
     * itself. Catching it and falling through to the UPDATE is what makes two simultaneous
     * first-ever plays land on one row with a count of two.
     */
    public function bump(string $slug): int
    {
        if (Flags::slug($slug) === null) {
            throw new InvalidArgumentException("refusing to count a bad slug: {$slug}");
        }

        $update = $this->db->prepare('UPDATE games SET plays = plays + 1 WHERE slug = ?');
        $update->execute([$slug]);

        if ($update->rowCount() === 0) {
            try {
                $this->db
                    ->prepare(
                        'INSERT INTO games (slug, availability, reason, updated_at, plays)
                         VALUES (?, ?, NULL, ?, 1)',
                    )
                    ->execute([$slug, Flags::ACTIVE, $this->clock->now()]);
            } catch (PDOException) {
                // Somebody else inserted the row between the UPDATE and here. Theirs
                // counted once; this one still has to.
                $update->execute([$slug]);
            }
        }

        $read = $this->db->prepare('SELECT plays FROM games WHERE slug = ?');
        $read->execute([$slug]);

        return (int) $read->fetchColumn();
    }

    public function history(int $limit = 50): array
    {
        // Clamped rather than interpolated: `LIMIT` cannot be a bound parameter on
        // every driver, so the value goes into the SQL — which means it must be an
        // integer this code produced, never one a caller supplied.
        $limit = max(1, min(500, $limit));

        $rows = $this->db
            ->query("SELECT slug, availability, reason, at
                       FROM flag_audit ORDER BY at DESC, id DESC LIMIT {$limit}")
            ->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn (array $row): array => [
                'slug' => (string) $row['slug'],
                'state' => (string) $row['availability'],
                'reason' => is_string($row['reason']) ? $row['reason'] : null,
                'at' => (int) $row['at'],
            ],
            $rows,
        );
    }
}
