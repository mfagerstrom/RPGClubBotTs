-- Pre-flight checks before dropping GOTM/NR-GOTM title/image columns.
-- Review and fix any rows returned here by setting GAMEDB_GAME_ID first.

SELECT ROUND_NUMBER, GAME_INDEX, GAME_TITLE, GAMEDB_GAME_ID
FROM GOTM_ENTRIES
WHERE GAMEDB_GAME_ID IS NULL;

SELECT ROUND_NUMBER, GAME_INDEX, GAME_TITLE, GAMEDB_GAME_ID
FROM NR_GOTM_ENTRIES
WHERE GAMEDB_GAME_ID IS NULL;

-- Example backfill update (replace placeholders, run only after verifying):
-- UPDATE GOTM_ENTRIES SET GAMEDB_GAME_ID = <id> WHERE ROUND_NUMBER = <round> AND GAME_INDEX = <idx>;
-- UPDATE NR_GOTM_ENTRIES SET GAMEDB_GAME_ID = <id> WHERE ROUND_NUMBER = <round> AND GAME_INDEX = <idx>;
-- COMMIT;
