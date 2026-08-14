# Database

A **MySQL** database is available on the hosting. This document records what it
may and may not be used for, and the rules any schema change must follow.

> **Current status: first use under way.** The backoffice is the first thing to
> write here — feature flags and aggregate counters
> ([specs/backoffice.md](specs/backoffice.md)). Everything else in §2 is still
> unscheduled. Do not create tables speculatively.

## 1. What it is *not* for

Game state stays **ephemeral and in memory**, in the Durable Object that owns the
room ([realtime-options.md](realtime-options.md),
[architecture.md](architecture.md) §1). A room's state dies with the room, by
design — it is a product principle, not an implementation detail:

- No positions, sensor samples, bumps or scores mid-round.
- No player identities, no accounts.
- No GPS coordinates, ever ([device-capabilities.md](device-capabilities.md) §6).

Writing live game state to MySQL would break the privacy promise on the hub's
about sheet and add a round-trip to a path that has a ±250 ms budget.

## 2. What it could legitimately be for

Only things that must **outlive a room**, and none are scheduled yet:

| Candidate | Notes |
| --- | --- |
| **Feature flags** ✅ **built** | The source of truth for which games are playable, written only by the admin centre. Everything *reads* a `flags.json` the writer regenerates, so no reader touches MySQL ([specs/backoffice.md](specs/backoffice.md) §2b) |
| All-time leaderboards | Needs a privacy decision first (what name is stored, for how long) |
| **Aggregate play counts per game** ✅ **built** | One anonymous counter per game — rounds that finished with a winner. Orders the hub and picks the HOT card ([specs/backoffice.md](specs/backoffice.md) §7). Shares the flags' row: one table, `games` |
| Feedback / bug reports from the about sheet | Low volume |
| Persisted room results | Only if we ever add "rematch tomorrow" style features |

Each requires its own entry in [roadmap.md](roadmap.md) before implementation.

## 3. Reachability — the constraint that shapes any design

**The Durable Object cannot reach this database.** Shared hosting binds MySQL to
localhost and does not expose port 3306 to the internet. Cloudflare Workers can
open TCP sockets, but there is nothing to connect *to*.

So the topology for any DB-backed feature is:

```
browser ──WebSocket──> Durable Object        (live gameplay, no DB)
   │
   └────── HTTPS ─────> PHP endpoint on the host ──> MySQL   (persistence)
```

This is where the **PHP backend earns its place**: it is the only component that
can talk to MySQL. A DB-backed feature means a small PHP API under `api/`, called
by the browser (or by the Durable Object over HTTPS at end of round), never a
direct database connection from the game loop.

The second arrow is no longer hypothetical: `api/played.php` is the Durable
Object's end-of-round call, and it is fire-and-forget with a short timeout, so a
database that is slow or gone cannot reach the round it is reporting on
([specs/backoffice.md](specs/backoffice.md) §7).

**A corollary worth stating, because it looked like a contradiction once.** The
Worker being unable to reach MySQL does *not* stop MySQL being the source of truth
for something the Worker reads. Feature flags work exactly this way: PHP owns the
table and regenerates a flat `flags.json`, and the Worker reads that file over
HTTPS. The constraint binds the *writer's* neighbour, not the data
([specs/backoffice.md](specs/backoffice.md) §2b). What is forbidden is a database
connection from the game loop, and there still isn't one.

## 4. Schema change rules

Mandatory, from the maintainer:

1. **An init script** that creates a working schema from empty.
2. **Idempotent migrations** — every migration must be safe to run repeatedly and
   in any already-applied state. Re-running the whole directory against an
   up-to-date database must be a no-op that exits 0.
3. **Local MariaDB for testing.** Every migration is proven against a local
   MariaDB instance before it goes near the host. MariaDB is the test target;
   avoid MySQL-only syntax so the two stay interchangeable.

   ✅ **This is now enforced by the suite rather than promised.**
   `api/tests/schema.php` builds its test schema by applying the **shipped
   `db/init.sql`** to a real MariaDB, and CI runs a `mariadb:11` service container
   for it. There is deliberately **no SQLite fallback**: the tests were written
   against a hand-translated SQLite schema for a while, which meant a
   MariaDB-only DDL error passed CI and would have failed on the host. A suite
   that skips silently proves nothing, so no server is a hard failure with the
   command to fix it.

   ⚠️ **The rule points both ways, and `0003_games.sql` is where it bit.** MariaDB
   has `ALTER TABLE IF EXISTS` and `ADD COLUMN IF NOT EXISTS`; MySQL has neither.
   The tests run against MariaDB and the host runs MySQL, so the MariaDB spelling
   would have passed CI and failed on the host. The portable form — a condition
   read from `information_schema` into a session variable, then `PREPARE` /
   `EXECUTE` — is what that migration uses to stay idempotent on both.

   Two guards worth knowing about: the suite **refuses any database whose name
   does not end in `_test`**, because it truncates every table it knows about;
   and `FONY_TEST_DSN`, when set, is the **only** candidate tried — an earlier
   version fell through to a different server when the explicit one was
   unreachable, and passed.

### Layout

```
db/
  init.sql                     full schema from empty, idempotent
  migrations/
    0001_flags.sql             applied in filename order, each idempotent
    0002_admin_link.sql
    0003_games.sql             game_flags -> games, plus the play counter
  migrate.php                  CLI runner
api/lib/Migrator.php           the runner itself, also driven from the admin page
```

**`init.sql` and the migrations must agree**, and that is now a test rather than a
comment: `api/tests/migrator_test.php` applies every migration to an empty database,
runs `init.sql` into a second one, and compares `information_schema`. If they diverge
one of the two is lying and there is no way to tell which — so the test says which
columns differ.

### The runner’s four deliberate limits

1. **No transaction around DDL.** MariaDB implicitly commits on `CREATE`/`ALTER`, so
   wrapping a migration would be *false safety* — a rollback would not undo the DDL
   while the code read as though it had. Instead the first failing statement stops the
   run and is reported with its file and 1-based index, and a file is recorded in the
   ledger **only when all of its statements succeeded**. Recovery is "fix the file and
   run it again", which is exactly what rule 2 exists to make safe. Proven against a
   real server: a migration whose second statement is broken leaves the first one
   applied, the third unrun, and the file still pending.
2. **`DELIMITER`, triggers and stored routines are refused, not attempted.** Their
   bodies contain semicolons that are not statement ends, and there is no honest way
   to split one without implementing `DELIMITER`. A loud "unsupported, apply it by
   hand" beats a confident wrong split.
3. **"Not installed" means exactly one error.** `Migrator::installed()` returns false only
   on SQLSTATE `42S02` — base table or view not found. It used to catch `Throwable` and
   return false for anything, which made a **wrong DSN indistinguishable from a fresh
   database**: the admin page offered to migrate a server it could not reach, and the deploy
   reported a schema problem when the fault was connectivity. Everything else (`2002`
   refused, `1049` unknown database, `28000` access denied) propagates, and the API answers
   `503 dbUnreachable` with the driver's own message
   ([specs/backoffice.md](specs/backoffice.md) §2c).
4. **The statement splitter is not `explode(';')`.** It skips `--`, `#` and `/* */`
   comments and quoted strings and identifiers, including backslash-escaped and
   doubled quotes — because a semicolon inside any of those would split a statement in
   half and produce an error pointing at something that is not the problem.

### Writing an idempotent migration

Prefer the forms MySQL/MariaDB support natively:

```sql
CREATE TABLE IF NOT EXISTS play_count (
  game_slug  VARCHAR(64)  NOT NULL PRIMARY KEY,
  plays      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                                 ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_play_count_plays ON play_count (plays);
INSERT IGNORE INTO play_count (game_slug) VALUES ('tap-duel');
```

`ADD COLUMN` has no `IF NOT EXISTS` in MySQL 8. Guard it:

```sql
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME   = 'play_count'
                  AND COLUMN_NAME  = 'last_played_at');
SET @sql := IF(@exists = 0,
  'ALTER TABLE play_count ADD COLUMN last_played_at TIMESTAMP NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
```

The runner also keeps a `schema_migrations` ledger so applied files are skipped —
but **the ledger is a speed-up, not the safety net**. A migration must still be
correct if run twice against a database whose ledger was lost.

### Rules of thumb

- Forward-only. No `DROP` of a column still read by deployed code; retire in two
  steps across two deploys.
- `utf8mb4` / `utf8mb4_unicode_ci` and `InnoDB` everywhere. Game names have emoji.
- No credentials in the repo. DB credentials follow the same pattern as the
  deploy secrets — GitHub Environments per `dev`/`prod`
  ([deployment.md](deployment.md) §3) — and on the host they live outside the
  web root.
- Never point `dev` at the production database.
- Migrations are `dev` commits and ride the normal `main` → `dev` → `prod` flow.

## 5. Local testing

`npm test` needs a MariaDB and will tell you so if it cannot find one. With a server
installed locally and root reachable over the Unix socket, it needs no configuration
at all. Otherwise:

```bash
docker run --rm -d --name fony-db -e MARIADB_ROOT_PASSWORD=dev \
  -p 3306:3306 mariadb:11

FONY_TEST_PASS=dev npm test
```

Or point it anywhere with `FONY_TEST_DSN` / `FONY_TEST_USER` / `FONY_TEST_PASS`. The
database name **must end in `_test`** — the suite truncates every table it knows about
and refuses anything else.

The suite creates `fonygames_test` from `db/init.sql`, plus throwaway
`fonygames_*_test` databases for the migration comparisons. It never touches
`fonygames`.

Applying the migrations twice and getting no changes the second time is the
idempotency check from rule 2, and it runs on the **shipped** files, not on fixtures
([testing.md](testing.md) §1.1a).
