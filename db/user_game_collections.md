# USER_GAME_COLLECTIONS table

User-owned GameDB entries used for personal collections.

## Structure

- **Primary/unique constraints:** `ENTRY_ID` primary key; unique index `UQ_USER_GAME_COLLECTIONS_DEDUP` on `(USER_ID, GAMEDB_GAME_ID, NVL(PLATFORM_ID, -1), OWNERSHIP_TYPE)`.
- **Indexes:** `IX_UGCOL_USER`, `IX_UGCOL_GAME`, `IX_UGCOL_PLATFORM`, `IX_UGCOL_SHARED`.
- **Triggers:** `TRG_USER_GAME_COLLECTIONS_UPD` updates `UPDATED_AT` before update.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ENTRY_ID | NUMBER | No | Identity | Row id. |
| USER_ID | VARCHAR2(50) | No | — | Discord user id. |
| GAMEDB_GAME_ID | NUMBER(10) | No | — | GameDB game id. |
| PLATFORM_ID | NUMBER | Yes | — | GameDB platform id. |
| OWNERSHIP_TYPE | VARCHAR2(30) | No | `'Digital'` | `Digital`, `Physical`, `Subscription`, `Other`. |
| NOTE | VARCHAR2(500) | Yes | — | Optional ownership notes. |
| IS_SHARED | NUMBER(1) | No | `1` | Visibility flag (`1` public by default). |
| CREATED_AT | TIMESTAMP | No | `SYSTIMESTAMP` | Created timestamp. |
| UPDATED_AT | TIMESTAMP | No | `SYSTIMESTAMP` | Updated timestamp. |
