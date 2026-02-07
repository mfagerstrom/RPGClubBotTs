# RPG_CLUB_XBOX_COLLECTION_IMPORTS table

Oracle tables storing Xbox collection import sessions, per-game review items, and
title to GameDB mapping memory.

## RPG_CLUB_XBOX_COLLECTION_IMPORTS

- **Primary/unique constraints:** `IMPORT_ID` primary key (identity).
- **Indexes:** `IX_XBOX_COLL_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_XBOX_COLL_IMPORTS_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| IMPORT_ID | NUMBER | No | Identity | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id of importer. |
| STATUS | VARCHAR2(20) | No | — | ACTIVE / PAUSED / COMPLETED / CANCELED. |
| CURRENT_INDEX | NUMBER | No | 0 | Last processed row index. |
| TOTAL_COUNT | NUMBER | No | 0 | Total Xbox library rows loaded into the session. |
| XUID | VARCHAR2(30) | Yes | — | Xbox user id when importing via API. |
| GAMERTAG | VARCHAR2(100) | Yes | — | Xbox gamertag when importing via API. |
| SOURCE_TYPE | VARCHAR2(20) | No | — | API or CSV. |
| SOURCE_FILE_NAME | VARCHAR2(255) | Yes | — | Uploaded CSV file name. |
| SOURCE_FILE_SIZE | NUMBER | Yes | — | Uploaded CSV file size in bytes. |
| TEMPLATE_VERSION | VARCHAR2(20) | Yes | — | Template version string. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |

## RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS

- **Primary/unique constraints:** `ITEM_ID` primary key (identity).
- **Indexes:** `IX_XBOX_COLL_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`;
  `IX_XBOX_COLL_ITEMS_TITLE` on `(XBOX_TITLE_ID)`.
- **Foreign keys:** `FK_XBOX_COLL_IMPORT_ITEMS` -> `RPG_CLUB_XBOX_COLLECTION_IMPORTS`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | Import session id. |
| ROW_INDEX | NUMBER | No | — | Row order from Xbox library list. |
| XBOX_TITLE_ID | VARCHAR2(40) | Yes | — | Xbox title id when known. |
| XBOX_PRODUCT_ID | VARCHAR2(80) | Yes | — | Xbox product id when known. |
| XBOX_TITLE_NAME | VARCHAR2(500) | No | — | Xbox game name. |
| RAW_PLATFORM | VARCHAR2(200) | Yes | — | Raw platform label. |
| RAW_OWNERSHIP_TYPE | VARCHAR2(60) | Yes | — | Raw ownership type input. |
| RAW_NOTE | VARCHAR2(500) | Yes | — | Raw note input. |
| RAW_GAMEDB_ID | NUMBER | Yes | — | GameDB id input value. |
| RAW_IGDB_ID | NUMBER | Yes | — | IGDB id input value. |
| PLATFORM_ID | NUMBER | Yes | — | Resolved GameDB platform id. |
| OWNERSHIP_TYPE | VARCHAR2(30) | Yes | — | Normalized ownership type. |
| NOTE | VARCHAR2(500) | Yes | — | Normalized note value. |
| STATUS | VARCHAR2(20) | No | — | PENDING / ADDED / UPDATED / SKIPPED / FAILED. |
| MATCH_CONFIDENCE | VARCHAR2(20) | Yes | — | Mapping confidence for review context. |
| MATCH_CANDIDATE_JSON | CLOB | Yes | — | Serialized candidate matches used by the review UI. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id. |
| COLLECTION_ENTRY_ID | NUMBER | Yes | — | Added or updated collection entry id. |
| RESULT_REASON | VARCHAR2(40) | Yes | — | Outcome reason key. |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error detail. |

## RPG_CLUB_XBOX_TITLE_GAMEDB_MAP

- **Primary/unique constraints:** `MAP_ID` primary key; unique `XBOX_TITLE_ID`.
- **Indexes:** `IX_XBOX_TITLE_GAMEDB_MAP_STATUS` on `(STATUS)`.
- **Triggers:** `TRG_XBOX_TITLE_GAMEDB_MAP_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| MAP_ID | NUMBER | No | Identity | Primary key. |
| XBOX_TITLE_ID | VARCHAR2(40) | No | — | Xbox title id. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id when status is MAPPED. |
| STATUS | VARCHAR2(20) | No | — | MAPPED or SKIPPED. |
| CREATED_BY | VARCHAR2(30) | Yes | — | Discord user id who set mapping status. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |
