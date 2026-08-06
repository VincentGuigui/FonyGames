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
-- Feature flags — the source of truth. docs/specs/backoffice.md §2b
--
-- Everything READS a flat flags.json that PHP regenerates on every write here; no
-- reader touches this table. The Worker could not reach it anyway
-- (docs/database.md §3), which is the constraint that shaped the whole design.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_flags (
  -- The same shape worker/router.ts and Flags::slug() enforce: ^[a-z][a-z0-9-]{0,31}$
  slug         VARCHAR(32)  NOT NULL,
  -- Deliberately NOT an ENUM. Adding a fourth state to an ENUM is a schema
  -- migration; here it is a code change, and the reader already fails open on a
  -- value it does not recognise.
  availability VARCHAR(16)  NOT NULL DEFAULT 'active',
  is_new       TINYINT(1)   NOT NULL DEFAULT 0,
  -- NULL, never ''. GameFlag.reason is optional in shared/flags.ts, and an empty
  -- string would render as a blank badge.
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  updated_at   BIGINT       NOT NULL,
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
  is_new       TINYINT(1)   NOT NULL DEFAULT 0,
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  at           BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_flag_audit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
