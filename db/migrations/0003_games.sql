-- 0003 — `game_flags` becomes `games`, and gains a play counter.
-- Rules: docs/database.md §4. Idempotent and safe to re-run in any already-applied state.
--
-- Why rename rather than add a second table: there is one row per game and both halves
-- are keyed by slug, so a `game_plays` table would be a join that never has a reason to
-- be a join. The old name described one column of a table that now holds two kinds of
-- thing.
--
-- ## Why this file is written with PREPARE instead of `IF EXISTS`
--
-- MariaDB has `ALTER TABLE IF EXISTS` and `ADD COLUMN IF NOT EXISTS`; MySQL has neither.
-- The tests run against MariaDB and the host runs MySQL (docs/database.md §4), so the
-- MariaDB spelling would pass CI and fail on the host — the exact failure the "avoid
-- MySQL-only syntax" rule exists to prevent, pointed the other way.
--
-- `information_schema` plus a prepared statement is the one form both accept. Each of the
-- three steps below is a no-op when it has already been done, which is what makes the
-- whole file re-runnable.

-- ---------------------------------------------------------------------------
-- 1. Rename, if there is something to rename.
--
-- Both halves of the condition matter. `game_flags` must exist (a fresh database has
-- neither table) and `games` must not (a re-run has both names resolved already). If both
-- somehow exist, do nothing and leave it for a human: merging two tables of flags is not
-- something a migration should guess at.
-- ---------------------------------------------------------------------------
SET @rename := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'game_flags')
    AND NOT EXISTS (SELECT 1 FROM information_schema.TABLES
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games'),
    'RENAME TABLE game_flags TO games',
    'DO 0'
  )
);
PREPARE stmt FROM @rename;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Create it, for a database that never had the old name.
--
-- Identical to the table in db/init.sql — which carries the END state of every migration,
-- so the two must agree column for column. `migrator_test.php` compares them and says
-- which column differs if they ever drift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
  slug         VARCHAR(32)  NOT NULL,
  availability VARCHAR(16)  NOT NULL DEFAULT 'active',
  is_new       TINYINT(1)   NOT NULL DEFAULT 0,
  reason       VARCHAR(120)     NULL DEFAULT NULL,
  updated_at   BIGINT       NOT NULL,
  plays        INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. Add the counter to a table that came through the rename without it.
--
-- Existing rows get 0, which is what "never counted" means everywhere else.
-- ---------------------------------------------------------------------------
SET @addplays := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND COLUMN_NAME = 'plays'),
    'DO 0',
    'ALTER TABLE games ADD COLUMN plays INT UNSIGNED NOT NULL DEFAULT 0'
  )
);
PREPARE stmt FROM @addplays;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
