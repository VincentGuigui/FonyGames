# Database

A **MySQL** database is available on the hosting. This document records what it
may and may not be used for, and the rules any schema change must follow.

> **Current status: not used.** Nothing in FonyGames writes to MySQL today. This
> document exists so the rules are already agreed the day something needs to.
> Do not create tables speculatively.

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
| All-time leaderboards | Needs a privacy decision first (what name is stored, for how long) |
| Aggregate play counts per game | Anonymous counters, useful for ordering the hub |
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
can talk to MySQL. A DB-backed feature means a small PHP API under `www/api/`,
called by the browser (or by the Durable Object over HTTPS at end of round),
never a direct database connection from the game loop.

## 4. Schema change rules

Mandatory, from the maintainer:

1. **An init script** that creates a working schema from empty.
2. **Idempotent migrations** — every migration must be safe to run repeatedly and
   in any already-applied state. Re-running the whole directory against an
   up-to-date database must be a no-op that exits 0.
3. **Local MariaDB for testing.** Every migration is proven against a local
   MariaDB instance before it goes near the host. MariaDB is the test target;
   avoid MySQL-only syntax so the two stay interchangeable.

### Layout (when first needed)

```
db/
  init.sql                     full schema from empty, idempotent
  migrations/
    0001_<description>.sql     applied in filename order, each idempotent
    0002_<description>.sql
  migrate.php                  runner: applies pending migrations, records them
```

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

```bash
docker run --rm -d --name fony-db \
  -e MARIADB_ROOT_PASSWORD=dev \
  -e MARIADB_DATABASE=fonygames \
  -p 3306:3306 mariadb:11

mysql -h 127.0.0.1 -u root -pdev fonygames < db/init.sql
php db/migrate.php                 # apply
php db/migrate.php                 # MUST be a clean no-op — this is the test
```

Running the runner twice and getting no changes the second time is the
idempotency check, and belongs in CI once the directory exists
([testing.md](testing.md)).
