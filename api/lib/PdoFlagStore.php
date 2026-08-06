<?php

declare(strict_types=1);

require_once __DIR__ . '/Clock.php';
require_once __DIR__ . '/FlagStore.php';
require_once __DIR__ . '/Flags.php';

/**
 * The real flag store: two tables, over PDO.
 * Spec: docs/specs/backoffice.md §2b · Schema: db/init.sql
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
            ->query('SELECT slug, availability, is_new, reason FROM game_flags ORDER BY slug')
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
                'availability' => in_array($row['availability'], Flags::STATES, true)
                    ? (string) $row['availability']
                    // A value outside the enum means the column drifted from the
                    // code. Fail open, like everything else about flags.
                    : Flags::ACTIVE,
                // SQLite hands back 0/1 as int, MySQL as string. `(bool) (int)`
                // reads both, where a bare `(bool)` would make the string "0" true.
                'isNew' => (bool) (int) $row['is_new'],
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

        $availability = in_array($flag['availability'] ?? null, Flags::STATES, true)
            ? (string) $flag['availability']
            : Flags::ACTIVE;
        $isNew = ($flag['isNew'] ?? false) === true ? 1 : 0;
        $reason = isset($flag['reason']) && is_string($flag['reason']) && trim($flag['reason']) !== ''
            ? mb_substr(trim($flag['reason']), 0, Flags::REASON_MAX)
            : null;
        $at = $this->clock->now();

        $this->db->beginTransaction();

        try {
            $exists = $this->db->prepare('SELECT 1 FROM game_flags WHERE slug = ?');
            $exists->execute([$slug]);

            if ($exists->fetchColumn() === false) {
                $this->db
                    ->prepare(
                        'INSERT INTO game_flags (slug, availability, is_new, reason, updated_at)
                         VALUES (?, ?, ?, ?, ?)',
                    )
                    ->execute([$slug, $availability, $isNew, $reason, $at]);
            } else {
                $this->db
                    ->prepare(
                        'UPDATE game_flags
                            SET availability = ?, is_new = ?, reason = ?, updated_at = ?
                          WHERE slug = ?',
                    )
                    ->execute([$availability, $isNew, $reason, $at, $slug]);
            }

            $this->db
                ->prepare(
                    'INSERT INTO flag_audit (slug, availability, is_new, reason, at)
                     VALUES (?, ?, ?, ?, ?)',
                )
                ->execute([$slug, $availability, $isNew, $reason, $at]);

            $this->db->commit();
        } catch (Throwable $e) {
            $this->db->rollBack();

            throw $e;
        }
    }

    public function history(int $limit = 50): array
    {
        // Clamped rather than interpolated: `LIMIT` cannot be a bound parameter on
        // every driver, so the value goes into the SQL — which means it must be an
        // integer this code produced, never one a caller supplied.
        $limit = max(1, min(500, $limit));

        $rows = $this->db
            ->query("SELECT slug, availability, is_new, reason, at
                       FROM flag_audit ORDER BY at DESC, id DESC LIMIT {$limit}")
            ->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static fn (array $row): array => [
                'slug' => (string) $row['slug'],
                'availability' => (string) $row['availability'],
                'isNew' => (bool) (int) $row['is_new'],
                'reason' => is_string($row['reason']) ? $row['reason'] : null,
                'at' => (int) $row['at'],
            ],
            $rows,
        );
    }
}
