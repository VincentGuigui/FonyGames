-- 0004 — the activity events table.
-- Rules: docs/database.md §4 · Spec: docs/specs/analytics.md §3
--
-- One `CREATE TABLE IF NOT EXISTS`, so the whole file is a no-op on a database that
-- already has it and needs none of the `information_schema` gymnastics 0003 does — that
-- file had a rename and an added column to make idempotent, and this one adds a table
-- that never existed under another name.
--
-- Identical to the table in db/init.sql, column for column: that file carries the END
-- state of every migration, and `migrator_test.php` builds both and reports which column
-- differs if the two ever drift.

CREATE TABLE IF NOT EXISTS analytics_event (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  at         BIGINT       NOT NULL,
  visitor_id CHAR(36)     NOT NULL,
  city       VARCHAR(100)     NULL DEFAULT NULL,
  country    CHAR(2)          NULL DEFAULT NULL,
  referrer   VARCHAR(255)     NULL DEFAULT NULL,
  nickname   VARCHAR(20)      NULL DEFAULT NULL,
  action     VARCHAR(16)  NOT NULL,
  object     VARCHAR(32)      NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_analytics_at (at),
  KEY idx_analytics_action_at (action, at),
  KEY idx_analytics_visitor_at (visitor_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
