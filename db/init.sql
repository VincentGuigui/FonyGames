-- FonyGames schema, from empty.
-- Rules: docs/database.md §4 — this file must create a working schema from nothing
-- and must be safe to run against an already-current database.
--
-- Idempotent throughout: every statement is `IF NOT EXISTS`, so re-running the whole
-- file is a no-op that exits 0. That is a hard requirement, not a nicety — it is what
-- makes "run init.sql" a safe thing to tell somebody to do.
--
-- Timestamps are **milliseconds since the epoch, in a BIGINT**, not DATETIME. Two
-- reasons, both concrete: the rest of the codebase speaks `Date.now()` milliseconds
-- (shared/protocol.ts), and a DATETIME column drags in the server's timezone, which
-- on shared hosting is somebody else's decision and can change under you.

-- ---------------------------------------------------------------------------
-- One row per game: what the operator decided, and what the players did.
-- docs/specs/backoffice.md §2b, §7
--
-- Everything READS a flat flags.json that PHP regenerates on every write here; no
-- reader touches this table. The Worker could not reach it anyway
-- (docs/database.md §3), which is the constraint that shaped the whole design.
--
-- Called `games` since 0003. It was `game_flags` while flags were all it held; the
-- play counter made that name a lie, and a table named after one of its columns is
-- a name that has to change again the next time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  -- The same shape worker/router.ts and Flags::slug() enforce: ^[a-z][a-z0-9-]{0,31}$
  slug         VARCHAR(32)  NOT NULL,
  -- One of `new`/`active`/`soon`/`hidden` (GameFlag.state in shared/flags.ts) — a
  -- game is exactly one of these, never two. Column name predates that: it held
  -- `active`/`disabled`/`hidden` before `is_new` folded in as `new`
  -- (db/migrations/0005_flag_state.sql). Deliberately NOT an ENUM. Adding a
  -- fourth state to an ENUM is a schema migration; here it was a code change,
  -- and the reader already fails open on a value it does not recognise.
  availability VARCHAR(16)  NOT NULL DEFAULT 'active',
  -- NULL, never ''. GameFlag.reason is optional in shared/flags.ts, and an empty
  -- string would render as a blank badge.
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  updated_at   BIGINT       NOT NULL,
  -- Rounds that finished with a winner. Incremented by the Worker through
  -- api/played.php; the hub orders the catalogue by it and badges the top one HOT.
  -- UNSIGNED because a negative play count is not a state that exists.
  plays        INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The change log. Append-only; written in the same transaction as the flag it
-- describes, so a flag can never have changed without a row here.
--
-- No `who` column: there is exactly one operator (docs/specs/backoffice.md §4), and
-- a column that always holds the same value is a column that lies about being useful.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS flag_audit (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  slug         VARCHAR(32)  NOT NULL,
  availability VARCHAR(16)  NOT NULL,
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  at           BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flag_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- The magic link. docs/specs/backoffice.md §4
--
-- A SINGLE-ROW table, pinned by `id = 1`. "One outstanding link at a time" is a rule
-- from the spec, and a primary key that can only hold one value enforces it in the
-- schema rather than in a DELETE somebody might forget to write.
--
-- Only the SHA-256 of the token is stored, so a database dump contains nothing
-- redeemable — worth doing even for something that expires in ten minutes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_link (
  id         TINYINT      NOT NULL DEFAULT 1,
  token_hash CHAR(64)     NOT NULL,
  expires_at BIGINT       NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Link-request attempts, for the rate limit.
--
-- The IP is stored **hashed**. The privacy boundary in §1 is about players rather than
-- the operator, but a table of raw addresses is a thing that needs explaining and a
-- hash costs one function call.
--
-- Rows older than the window are pruned on every request, so this table stays small
-- without a cron job.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_link_attempt (
  id      BIGINT   NOT NULL AUTO_INCREMENT,
  ip_hash CHAR(64) NOT NULL,
  at      BIGINT   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_attempt_ip_at (ip_hash, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Activity events. docs/specs/analytics.md §3
--
-- **The one table in this schema that is about a person rather than a thing.** The
-- privacy boundary it lives inside is in docs/specs/analytics.md §1, and it was
-- deliberately widened to allow this — the earlier rule was aggregates only.
--
-- What is NOT here, and must never be added: the IP address. It reaches PHP, is sent
-- to a geolocation service to become a city, and is then dropped. `city`/`country` are
-- the only trace of it, which is the whole point of resolving them server-side rather
-- than storing the address and resolving later.
--
-- `at` is milliseconds since the epoch in a BIGINT, like every other timestamp here,
-- and is generated SERVER-side — a client clock is both wrong and forgeable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_event (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  at         BIGINT       NOT NULL,
  -- A UUIDv4 minted by PHP into an HttpOnly cookie, so the browser cannot choose or
  -- read it. Not a player id: it survives across rooms and games, which is exactly
  -- what makes it the sensitive column in this table.
  visitor_id CHAR(36)     NOT NULL,
  -- From IP geolocation, and nullable throughout: no token configured, the service
  -- being down, or a private address all mean "not known" rather than an error.
  city       VARCHAR(100)     NULL DEFAULT NULL,
  -- ISO 3166-1 alpha-2.
  country    CHAR(2)          NULL DEFAULT NULL,
  -- `document.referrer`, truncated. NULL when the visitor arrived with none, which is
  -- the common case for a link opened from a messaging app.
  referrer   VARCHAR(255)     NULL DEFAULT NULL,
  -- The name the player typed, 20 chars like `sanitiseName` in shared/names.ts. NULL
  -- until they have set one, which is most of the hub.
  nickname   VARCHAR(20)      NULL DEFAULT NULL,
  -- Controlled by an allowlist in PHP (`Analytics::ACTIONS`), deliberately NOT an
  -- ENUM — same reasoning as `games.availability` above: a seventh action should be a
  -- code change, not a migration.
  action     VARCHAR(16)  NOT NULL,
  -- What the action was done to: a game slug, or NULL for one that has no object.
  object     VARCHAR(32)      NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_analytics_at (at),
  KEY idx_analytics_action_at (action, at),
  -- Serves the per-visitor rate limit, which reads this table rather than keeping
  -- state of its own (api/analytics.php).
  KEY idx_analytics_visitor_at (visitor_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
