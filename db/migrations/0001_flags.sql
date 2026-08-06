-- 0001 — feature flags and their change log.
-- Rules: docs/database.md §4. Every migration is idempotent and safe to re-run in
-- any already-applied state.
--
-- Identical to the two tables in db/init.sql, on purpose. This is the first
-- migration, so "apply every migration to an empty database" and "run init.sql" must
-- land on the same schema; if they diverge, one of the two is a lie and there is no
-- way to tell which. A later migration will not have that property and does not need
-- it — init.sql will simply carry the end state.

CREATE TABLE IF NOT EXISTS game_flags (
  slug         VARCHAR(32)  NOT NULL,
  availability VARCHAR(16)  NOT NULL DEFAULT 'active',
  is_new       TINYINT(1)   NOT NULL DEFAULT 0,
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  updated_at   BIGINT       NOT NULL,
  PRIMARY KEY (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
