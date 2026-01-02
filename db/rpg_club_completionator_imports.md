# RPG_CLUB_COMPLETIONATOR_IMPORTS table

Oracle tables storing Completionator CSV import sessions and rows.

## RPG_CLUB_COMPLETIONATOR_IMPORTS

- **Primary/unique constraints:** `IMPORT_ID` primary key (identity).
- **Indexes:** `IX_COMPLETIONATOR_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_COMPLETIONATOR_IMPORTS_UPD` updates `UPDATED_AT`.

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

## RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS

- **Primary/unique constraints:** `ITEM_ID` primary key (identity).
- **Indexes:** `IX_COMPLETIONATOR_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`.
- **Foreign keys:** `FK_COMPLETIONATOR_IMPORT_ITEMS` -> `RPG_CLUB_COMPLETIONATOR_IMPORTS`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | Import session id. |
| ROW_INDEX | NUMBER | No | — | Row order from CSV. |
| GAME_TITLE | VARCHAR2(500) | No | — | Game title from CSV. |
| PLATFORM_NAME | VARCHAR2(200) | Yes | — | Platform from CSV. |
| REGION_NAME | VARCHAR2(200) | Yes | — | Region from CSV. |
| SOURCE_TYPE | VARCHAR2(100) | Yes | — | Completionator completion type. |
| TIME_TEXT | VARCHAR2(50) | Yes | — | Raw time string (e.g., 19h:45m:00s). |
| COMPLETED_AT | DATE | Yes | — | Parsed completion date. |
| COMPLETION_TYPE | VARCHAR2(50) | Yes | — | Mapped completion type. |
| PLAYTIME_HRS | NUMBER | Yes | — | Parsed hours. |
| STATUS | VARCHAR2(20) | No | — | PENDING / SKIPPED / IMPORTED / UPDATED / ERROR. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Matched GameDB id. |
| COMPLETION_ID | NUMBER | Yes | — | Created/updated completion id. |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error detail. |
