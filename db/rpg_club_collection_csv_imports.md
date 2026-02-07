# RPG_CLUB_COLLECTION_CSV_IMPORTS table

Oracle tables storing custom CSV collection import sessions and per-row review items.

## RPG_CLUB_COLLECTION_CSV_IMPORTS

- **Primary/unique constraints:** `IMPORT_ID` primary key (identity).
- **Indexes:** `IX_COLL_CSV_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_COLL_CSV_IMPORTS_UPD` updates `UPDATED_AT`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| IMPORT_ID | NUMBER | No | Identity | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id of importer. |
| STATUS | VARCHAR2(20) | No | — | ACTIVE / PAUSED / COMPLETED / CANCELED. |
| CURRENT_INDEX | NUMBER | No | 0 | Last processed row index. |
| TOTAL_COUNT | NUMBER | No | 0 | Total CSV rows loaded into the session. |
| SOURCE_FILE_NAME | VARCHAR2(255) | Yes | — | Uploaded CSV file name. |
| SOURCE_FILE_SIZE | NUMBER | Yes | — | Uploaded CSV file size in bytes. |
| TEMPLATE_VERSION | VARCHAR2(20) | Yes | — | Template version string. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edits. |

## RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS

- **Primary/unique constraints:** `ITEM_ID` primary key (identity).
- **Indexes:** `IX_COLL_CSV_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`.
- **Foreign keys:** `FK_COLL_CSV_IMPORT_ITEMS` -> `RPG_CLUB_COLLECTION_CSV_IMPORTS`.

### Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | Import session id. |
| ROW_INDEX | NUMBER | No | — | Row index from the uploaded CSV. |
| RAW_TITLE | VARCHAR2(500) | No | — | CSV title value. |
| RAW_PLATFORM | VARCHAR2(200) | Yes | — | CSV platform value. |
| RAW_OWNERSHIP_TYPE | VARCHAR2(60) | Yes | — | CSV ownership type value. |
| RAW_NOTE | VARCHAR2(500) | Yes | — | CSV note value. |
| RAW_GAMEDB_ID | NUMBER | Yes | — | CSV GameDB id value. |
| RAW_IGDB_ID | NUMBER | Yes | — | CSV IGDB id value. |
| PLATFORM_ID | NUMBER | Yes | — | Resolved GameDB platform id. |
| OWNERSHIP_TYPE | VARCHAR2(30) | Yes | — | Normalized ownership type. |
| NOTE | VARCHAR2(500) | Yes | — | Normalized note value. |
| STATUS | VARCHAR2(20) | No | — | PENDING / ADDED / UPDATED / SKIPPED / FAILED. |
| MATCH_CONFIDENCE | VARCHAR2(20) | Yes | — | Mapping confidence for review context. |
| MATCH_CANDIDATE_JSON | CLOB | Yes | — | Serialized candidate matches used by the review UI. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Mapped GameDB id. |
| COLLECTION_ENTRY_ID | NUMBER | Yes | — | Added or updated collection entry id. |
| RESULT_REASON | VARCHAR2(40) | Yes | — | Outcome reason key (duplicate/manual skip/remap/etc). |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error detail. |
