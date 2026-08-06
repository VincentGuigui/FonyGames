-- 0002 — the magic link and its rate-limit history.
-- Rules: docs/database.md §4. Idempotent and safe to re-run.
--
-- Same two tables db/init.sql now carries. Unlike 0001, this one is not the whole
-- schema: init.sql holds the END state of every migration, which is what makes
-- "run init.sql" and "apply every migration" land in the same place.

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
