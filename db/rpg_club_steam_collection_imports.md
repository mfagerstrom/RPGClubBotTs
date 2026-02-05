# RPG_CLUB_STEAM_COLLECTION_IMPORTS table

Oracle tables storing Steam collection import sessions, per-game review items, and
app-to-GameDB mapping memory.

## RPG_CLUB_STEAM_COLLECTION_IMPORTS

- **Primary/unique constraints:** `IMPORT_ID` primary key (identity).
- **Indexes:** `IX_STEAM_COLL_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_STEAM_COLL_IMPORTS_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| IMPORT_ID | NUMBER | No | Identity | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id of importer. |
| STATUS | VARCHAR2(20) | No | — | ACTIVE / PAUSED / COMPLETED / CANCELED. |
| CURRENT_INDEX | NUMBER | No | 0 | Last processed row index. |
| TOTAL_COUNT | NUMBER | No | 0 | Total Steam library rows loaded into the session. |
| STEAM_ID64 | VARCHAR2(20) | No | — | Resolved Steam ID64 used for API reads. |
| STEAM_PROFILE_REF | VARCHAR2(255) | Yes | — | Original user-supplied profile reference. |
| SOURCE_PROFILE_NAME | VARCHAR2(255) | Yes | — | Best-known profile label at import start. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |

## RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS

- **Primary/unique constraints:** `ITEM_ID` primary key (identity).
- **Indexes:** `IX_STEAM_COLL_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`;
  `IX_STEAM_COLL_ITEMS_APP` on `(STEAM_APP_ID)`.
- **Foreign keys:** `FK_STEAM_COLL_IMPORT_ITEMS` -> `RPG_CLUB_STEAM_COLLECTION_IMPORTS`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | Import session id. |
| ROW_INDEX | NUMBER | No | — | Row order from Steam owned games list. |
| STEAM_APP_ID | NUMBER | No | — | Steam application id. |
| STEAM_APP_NAME | VARCHAR2(500) | No | — | Steam game name. |
| PLAYTIME_FOREVER_MIN | NUMBER | Yes | — | Total lifetime minutes played. |
| PLAYTIME_WINDOWS_MIN | NUMBER | Yes | — | Windows playtime minutes. |
| PLAYTIME_MAC_MIN | NUMBER | Yes | — | macOS playtime minutes. |
| PLAYTIME_LINUX_MIN | NUMBER | Yes | — | Linux playtime minutes. |
| PLAYTIME_DECK_MIN | NUMBER | Yes | — | Steam Deck playtime minutes. |
| LAST_PLAYED_AT | DATE | Yes | — | Last played timestamp derived from Unix time. |
| STATUS | VARCHAR2(20) | No | — | PENDING / ADDED / UPDATED / SKIPPED / FAILED. |
| MATCH_CONFIDENCE | VARCHAR2(20) | Yes | — | Mapping confidence for review context. |
| MATCH_CANDIDATE_JSON | CLOB | Yes | — | Serialized candidate matches used by the review UI. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id. |
| COLLECTION_ENTRY_ID | NUMBER | Yes | — | Added or updated collection entry id. |
| RESULT_REASON | VARCHAR2(40) | Yes | — | Outcome reason key (duplicate/manual skip/remap/etc). |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error detail. |

## RPG_CLUB_STEAM_APP_GAMEDB_MAP

- **Primary/unique constraints:** `MAP_ID` primary key; unique `STEAM_APP_ID`.
- **Indexes:** `IX_STEAM_APP_GAMEDB_MAP_STATUS` on `(STATUS)`.
- **Triggers:** `TRG_STEAM_APP_GAMEDB_MAP_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| MAP_ID | NUMBER | No | Identity | Primary key. |
| STEAM_APP_ID | NUMBER | No | — | Steam app id. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id when status is MAPPED. |
| STATUS | VARCHAR2(20) | No | — | MAPPED or SKIPPED. |
| CREATED_BY | VARCHAR2(30) | Yes | — | Discord user id who set mapping status. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |
