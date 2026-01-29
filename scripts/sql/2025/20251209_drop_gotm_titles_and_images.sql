-- Run this only after every GOTM/NR-GOTM row has a non-null GAMEDB_GAME_ID.
-- Drops legacy title/image columns in one statement per table.

ALTER TABLE GOTM_ENTRIES DROP (GAME_TITLE, IMAGE_BLOB, IMAGE_MIME_TYPE);

ALTER TABLE NR_GOTM_ENTRIES DROP (GAME_TITLE, IMAGE_BLOB, IMAGE_MIME_TYPE);
