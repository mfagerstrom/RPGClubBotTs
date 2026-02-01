# RPG_CLUB_GOTM_AUDIT_ITEMS table

Stores individual GOTM and NR-GOTM audit items for review and import.

## Structure

- **Primary/unique constraints:** `RPG_CLUB_GOTM_AUDIT_ITEMS` primary key on `ITEM_ID`.
- **Indexes:** `IX_GOTM_AUDIT_ITEMS_IMPORT` on `(IMPORT_ID, STATUS, ROW_INDEX)`;
  `IX_GOTM_AUDIT_ITEMS_ROUND` on `(IMPORT_ID, KIND, ROUND_NUMBER)`.
- **Foreign keys:** `FK_GOTM_AUDIT_ITEMS` references `RPG_CLUB_GOTM_AUDIT_IMPORTS(IMPORT_ID)`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ITEM_ID | NUMBER | No | Identity | Primary key. |
| IMPORT_ID | NUMBER | No | — | FK to audit import session. |
| ROW_INDEX | NUMBER | No | — | Row order in the source CSV. |
| KIND | VARCHAR2(10) | No | — | gotm or nr-gotm. |
| ROUND_NUMBER | NUMBER | No | — | Round number. |
| MONTH_YEAR | VARCHAR2(50) | No | — | Month/year label. |
| GAME_INDEX | NUMBER | No | — | Game index within the round. |
| GAME_TITLE | VARCHAR2(500) | No | — | Source game title. |
| THREAD_ID | VARCHAR2(30) | Yes | — | Discord thread id. |
| REDDIT_URL | VARCHAR2(1000) | Yes | — | Reddit link. |
| STATUS | VARCHAR2(20) | No | — | PENDING, IMPORTED, SKIPPED, or ERROR. |
| GAMEDB_GAME_ID | NUMBER | Yes | — | Linked GameDB id when resolved. |
| ERROR_TEXT | VARCHAR2(2000) | Yes | — | Error details for failed items. |
