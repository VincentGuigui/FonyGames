-- 0005 — one state per game, not two.
-- Rules: docs/database.md §4. Idempotent and safe to re-run in any already-applied state.
--
-- `availability` (`active`/`disabled`/`hidden`) and `is_new` collapse into one column:
-- a game is now exactly `new`, `active`, `soon` (renamed from `disabled`), or `hidden`
-- — never two of these at once (docs/specs/backoffice.md §5). The backfill is lossless
-- for anything a player could ever see: `shared/flags.ts`'s own `cardState()` never
-- read `isNew` for a `disabled` or `hidden` game, so the only combination that changes
-- meaning is `active` + `is_new`, which becomes `new` below. The column keeps its old
-- name, `availability` — it was already a free-form `VARCHAR(16)` for exactly this
-- reason (db/init.sql's own comment), so widening what it holds is the whole migration.

UPDATE games SET availability = 'soon' WHERE availability = 'disabled';
UPDATE flag_audit SET availability = 'soon' WHERE availability = 'disabled';

-- ---------------------------------------------------------------------------
-- Backfill `new`, guarded on `is_new` still existing — a re-run after the column
-- below has already been dropped must not try to read it again.
-- ---------------------------------------------------------------------------
SET @backfill_games_new := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND COLUMN_NAME = 'is_new'),
    "UPDATE games SET availability = 'new' WHERE availability = 'active' AND is_new = 1",
    'DO 0'
  )
);
PREPARE stmt FROM @backfill_games_new;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @backfill_audit_new := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flag_audit' AND COLUMN_NAME = 'is_new'),
    "UPDATE flag_audit SET availability = 'new' WHERE availability = 'active' AND is_new = 1",
    'DO 0'
  )
);
PREPARE stmt FROM @backfill_audit_new;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Drop the now-redundant column from both tables, if still present.
-- ---------------------------------------------------------------------------
SET @drop_games_is_new := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'games' AND COLUMN_NAME = 'is_new'),
    'ALTER TABLE games DROP COLUMN is_new',
    'DO 0'
  )
);
PREPARE stmt FROM @drop_games_is_new;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @drop_audit_is_new := (
  SELECT IF(
    EXISTS (SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flag_audit' AND COLUMN_NAME = 'is_new'),
    'ALTER TABLE flag_audit DROP COLUMN is_new',
    'DO 0'
  )
);
PREPARE stmt FROM @drop_audit_is_new;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
