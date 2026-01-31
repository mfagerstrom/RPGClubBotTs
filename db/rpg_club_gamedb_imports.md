# RPG_CLUB_GAMEDB_IMPORTS table

Oracle tables storing GameDB CSV import sessions and rows.

## RPG_CLUB_GAMEDB_IMPORTS

- **Primary/unique constraints:** `IMPORT_ID` primary key (identity).
- **Indexes:** `IX_GAMEDB_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_GAMEDB_IMPORTS_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| IMPORT_ID | NUMBER | No | Identity | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id of importer. |
| STATUS | VARCHAR2(20) | No | — | ACTIVE / PAUSED / COMPLETED / CANCELED. |
| CURRENT_INDEX | NUMBER | No | 0 | Last processed row index. |
| TOTAL_COUNT | NUMBER | No | 0 | Total rows in import. |
| SOURCE_FILENAME | VARCHAR2(255) | Yes | — | Original CSV filename. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |

## RPG_CLUB_GAMEDB_IMPORT_ITEMS

- **Primary/unique constraints:** `ITEM_ID` primary key (identity).
- **Indexes:** `IX_GAMEDB_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`.
- **Foreign keys:** `FK_GAMEDB_IMPORT_ITEMS` -> `RPG_CLUB_GAMEDB_IMPORTS`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | Import session id. |
| ROW_INDEX | NUMBER | No | — | Row order from CSV. |
| GAME_TITLE | VARCHAR2(500) | No | — | Game title from CSV. |
| RAW_GAME_TITLE | VARCHAR2(500) | Yes | — | Original CSV title before stripping date suffix. |
| PLATFORM_NAME | VARCHAR2(200) | Yes | — | Platform from CSV. |
| REGION_NAME | VARCHAR2(200) | Yes | — | Region from CSV. |
| INITIAL_RELEASE_DATE | DATE | Yes | — | Initial release date from CSV. |
| STATUS | VARCHAR2(20) | No | — | PENDING / SKIPPED / IMPORTED / ERROR. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Imported GameDB id. |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error detail. |

## RPG_CLUB_GAMEDB_IMPORT_TITLE_MAP

- **Primary/unique constraints:** `MAP_ID` primary key; unique `TITLE_NORM`.
- **Indexes:** `UX_GAMEDB_IMPORT_TITLE_NORM` on `TITLE_NORM`;
  `IX_GAMEDB_IMPORT_TITLE_STATUS` on `STATUS`.
- **Triggers:** `TRG_GAMEDB_IMPORT_TITLE_MAP_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| MAP_ID | NUMBER | No | Identity | Primary key. |
| TITLE_RAW | VARCHAR2(500) | No | — | Raw Completionator title. |
| TITLE_NORM | VARCHAR2(500) | No | — | Normalized title for matching. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id if status is MAPPED. |
| STATUS | VARCHAR2(20) | No | — | MAPPED or SKIPPED. |
| CREATED_BY | VARCHAR2(30) | Yes | — | Discord user id who set the mapping. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |
