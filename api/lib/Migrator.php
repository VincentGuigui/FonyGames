<?php

declare(strict_types=1);

/**
 * Applying `db/migrations/*.sql`, and recording what has been applied.
 * Spec: docs/database.md §4, §5 · docs/specs/backoffice.md §6
 *
 * ## The ledger is a speed-up, not the safety net
 *
 * `database.md` §4 already says this and it shapes the whole class: every migration must be
 * **idempotent**, correct even if run twice against a database whose ledger was lost. So
 * `schema_migrations` exists to skip work and to give the operator a list, not to make
 * unsafe files safe.
 *
 * ## No transaction around DDL, deliberately
 *
 * MariaDB implicitly commits on `CREATE`/`ALTER`, so wrapping a migration in a transaction
 * would be **false safety** — a rollback would not undo the DDL, but the code would read as
 * though it did. Instead: statements run in order, the first failure stops the run and is
 * reported with its file and index, and the ledger records a file **only when all of its
 * statements succeeded**. Recovery is "fix the file and run it again", which is exactly
 * what the idempotency rule is for.
 */
final class Migrator
{
    /** The ledger. Created by this class, because it is what records migrations. */
    private const LEDGER = 'schema_migrations';

    public function __construct(
        private PDO $db,
        /** Absolute path of `db/migrations/`. */
        private string $dir,
    ) {
        $this->db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    /**
     * Split a SQL file into statements.
     *
     * **A naive `explode(';')` is the trap here**: a semicolon inside a string literal or a
     * comment would split a statement in half, and the resulting error would point at
     * something that is not the problem. So this walks the text, skipping `--` and `#` line
     * comments, `/* *​/` blocks, and single- and double-quoted strings (honouring backslash
     * escapes and doubled quotes).
     *
     * What it deliberately does **not** support is `DELIMITER`, triggers and stored
     * routines, whose bodies contain semicolons that are not statement ends. Rather than
     * mangle one, `check()` refuses the file outright — a loud "unsupported" beats a
     * confident wrong split.
     *
     * @return list<string>
     */
    public static function statements(string $sql): array
    {
        $out = [];
        $current = '';
        $len = strlen($sql);
        $i = 0;

        while ($i < $len) {
            $c = $sql[$i];
            $next = $i + 1 < $len ? $sql[$i + 1] : '';

            // Line comments: `-- ` and `#`. Consumed, not kept — they are noise to the
            // server and they are where stray semicolons hide.
            if (($c === '-' && $next === '-') || $c === '#') {
                while ($i < $len && $sql[$i] !== "\n") {
                    $i++;
                }
                continue;
            }

            // Block comment.
            if ($c === '/' && $next === '*') {
                $end = strpos($sql, '*/', $i + 2);
                $i = $end === false ? $len : $end + 2;
                continue;
            }

            // Quoted string or identifier: copied verbatim, semicolons and all.
            if ($c === "'" || $c === '"' || $c === '`') {
                $quote = $c;
                $current .= $c;
                $i++;
                while ($i < $len) {
                    $ch = $sql[$i];
                    if ($ch === '\\' && $quote !== '`') {
                        // Backslash escape: take both characters, so `\'` does not end it.
                        $current .= $ch . ($sql[$i + 1] ?? '');
                        $i += 2;
                        continue;
                    }
                    $current .= $ch;
                    $i++;
                    if ($ch === $quote) {
                        // A doubled quote is an escaped quote, not the end.
                        if (($sql[$i] ?? '') === $quote) {
                            $current .= $quote;
                            $i++;
                            continue;
                        }
                        break;
                    }
                }
                continue;
            }

            if ($c === ';') {
                $trimmed = trim($current);
                if ($trimmed !== '') {
                    $out[] = $trimmed;
                }
                $current = '';
                $i++;
                continue;
            }

            $current .= $c;
            $i++;
        }

        // A trailing statement with no final semicolon is still a statement.
        $trimmed = trim($current);
        if ($trimmed !== '') {
            $out[] = $trimmed;
        }

        return $out;
    }

    /**
     * Is this file something we can run at all?
     *
     * @return string|null null when fine, otherwise why not.
     */
    public static function check(string $sql): ?string
    {
        // Case-insensitive, because `delimiter` is as valid as `DELIMITER`.
        foreach (['DELIMITER', 'CREATE TRIGGER', 'CREATE PROCEDURE', 'CREATE FUNCTION'] as $unsupported) {
            if (preg_match('/\b' . preg_quote($unsupported, '/') . '\b/i', $sql) === 1) {
                return "contains {$unsupported}, which this runner does not support:"
                    . ' its body holds semicolons that are not statement ends, and splitting'
                    . ' it would produce a confident wrong answer. Apply it by hand.';
            }
        }

        return null;
    }

    /** Has the schema been installed at all? Cheap, portable, and no exception escapes. */
    public function installed(): bool
    {
        try {
            $this->db->query('SELECT 1 FROM game_flags LIMIT 1');

            return true;
        } catch (Throwable) {
            // Any error is "not installed" for our purposes: the caller's next move is to
            // run the migrations either way.
            return false;
        }
    }

    /** Create the ledger. Idempotent, and the first thing any read or write does. */
    public function ensureLedger(): void
    {
        $this->db->exec(
            'CREATE TABLE IF NOT EXISTS ' . self::LEDGER . ' (
                filename   VARCHAR(255) NOT NULL,
                applied_at BIGINT       NOT NULL,
                PRIMARY KEY (filename)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
        );
    }

    /**
     * Every migration file on disk, in filename order.
     *
     * Sorted by name, which is why they are numbered. `sort()` on `0002` vs `0010` is
     * correct because the numbers are zero-padded — a rule worth keeping.
     *
     * @return list<string>
     */
    public function files(): array
    {
        $found = glob($this->dir . '/*.sql');
        if ($found === false) {
            return [];
        }

        $names = array_map('basename', $found);
        sort($names);

        return array_values($names);
    }

    /** @return array<string, int> filename → applied_at */
    public function applied(): array
    {
        $this->ensureLedger();

        $out = [];
        foreach ($this->db->query('SELECT filename, applied_at FROM ' . self::LEDGER)->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $out[(string) $row['filename']] = (int) $row['applied_at'];
        }

        return $out;
    }

    /** @return list<string> */
    public function pending(): array
    {
        $applied = $this->applied();

        return array_values(array_filter($this->files(), static fn (string $f): bool => !isset($applied[$f])));
    }

    /**
     * Apply every pending migration.
     *
     * Stops at the first failure and says exactly where: the file, the index of the
     * statement within it, and the driver's message. A generic "migration failed" would
     * leave the operator opening files by hand, which is the moment they are most likely to
     * make it worse.
     *
     * @return array{
     *   ok: bool,
     *   applied: list<string>,
     *   skipped: list<string>,
     *   failed?: array{file: string, statement: int, error: string}
     * }
     */
    public function apply(int $now): array
    {
        $this->ensureLedger();

        $done = [];
        $alreadyApplied = array_keys($this->applied());

        foreach ($this->pending() as $file) {
            $path = $this->dir . '/' . $file;
            $sql = (string) file_get_contents($path);

            $refusal = self::check($sql);
            if ($refusal !== null) {
                return [
                    'ok' => false,
                    'applied' => $done,
                    'skipped' => $alreadyApplied,
                    'failed' => ['file' => $file, 'statement' => 0, 'error' => $refusal],
                ];
            }

            $statements = self::statements($sql);

            foreach ($statements as $index => $statement) {
                try {
                    $this->db->exec($statement);
                } catch (Throwable $e) {
                    // No rollback attempted: MariaDB has already committed whatever DDL
                    // ran. The ledger not recording this file is what makes re-running it
                    // after a fix the correct recovery.
                    return [
                        'ok' => false,
                        'applied' => $done,
                        'skipped' => $alreadyApplied,
                        'failed' => [
                            'file' => $file,
                            // 1-based: "statement 3" should mean the third one.
                            'statement' => $index + 1,
                            'error' => $e->getMessage(),
                        ],
                    ];
                }
            }

            // Recorded only now, with every statement through.
            $this->db
                ->prepare('INSERT INTO ' . self::LEDGER . ' (filename, applied_at) VALUES (?, ?)')
                ->execute([$file, $now]);
            $done[] = $file;
        }

        return ['ok' => true, 'applied' => $done, 'skipped' => $alreadyApplied];
    }

    /**
     * What the admin page shows.
     *
     * @return array{installed: bool, applied: array<string, int>, pending: list<string>, files: list<string>}
     */
    public function status(): array
    {
        return [
            'installed' => $this->installed(),
            'applied' => $this->applied(),
            'pending' => $this->pending(),
            'files' => $this->files(),
        ];
    }
}
