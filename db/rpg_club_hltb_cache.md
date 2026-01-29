# RPG_CLUB_HLTB_CACHE table

Cache for HowLongToBeat data keyed by GameDB id.

## Structure

- **Primary/unique constraints:** `CACHE_ID` primary key; unique index on `GAMEDB_GAME_ID`.
- **Indexes:** `UQ_HLTB_GAME_ID` on `(GAMEDB_GAME_ID)`.
- **Foreign keys:** `FK_HLTB_GAME` references `GAMEDB_GAMES(GAME_ID)`.

## Columns

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| CACHE_ID | NUMBER | No | Identity primary key. |
| GAMEDB_GAME_ID | NUMBER | No | FK to `GAMEDB_GAMES`. |
| HLTB_NAME | VARCHAR2(255) | Yes | HLTB game title. |
| HLTB_URL | VARCHAR2(512) | Yes | HLTB game URL. |
| HLTB_IMAGE_URL | VARCHAR2(512) | Yes | HLTB image URL. |
| MAIN | VARCHAR2(50) | Yes | Main Story time. |
| MAIN_SIDES | VARCHAR2(50) | Yes | Main + Sides time. |
| COMPLETIONIST | VARCHAR2(50) | Yes | Completionist time. |
| SINGLE_PLAYER | VARCHAR2(50) | Yes | Single-Player time. |
| CO_OP | VARCHAR2(50) | Yes | Co-Op time. |
| VS | VARCHAR2(50) | Yes | Vs. time. |
| SOURCE_QUERY | VARCHAR2(255) | Yes | Query used when scraped. |
| SCRAPED_AT | TIMESTAMP | Yes | When data was scraped. |
| UPDATED_AT | TIMESTAMP | Yes | When cache was last updated. |
