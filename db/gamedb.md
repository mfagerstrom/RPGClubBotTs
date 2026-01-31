# GAMEDB tables

Game metadata ingested from IGDB and stored for bot lookups. Schema created by
`20251209_recreate_gamedb_schema.sql` with metadata extensions in
`20251210_gamedb_expanded_metadata.sql`.

## GAMEDB_GAMES

- Primary/unique constraints: `GAME_ID` primary key; unique `IGDB_ID`;
  `COLLECTION_ID` FK to `GAMEDB_COLLECTIONS`.
- Indexes/triggers: identity PK; `TRG_GAMEDB_GAMES_UPD` refreshes `UPDATED_AT` on update.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| GAME_ID | NUMBER | No | Identity primary key. |
| TITLE | VARCHAR2(255) | No | Game title. |
| DESCRIPTION | CLOB | Yes | Long-form summary from IGDB. |
| IMAGE_DATA | BLOB | Yes | Cover art bytes, if downloaded. |
| ART_DATA | BLOB | Yes | Artwork bytes, if downloaded. |
| IGDB_ID | NUMBER | Yes | Unique IGDB game id. |
| SLUG | VARCHAR2(255) | Yes | IGDB slug. |
| TOTAL_RATING | NUMBER | Yes | IGDB aggregated rating. |
| IGDB_URL | VARCHAR2(512) | Yes | Canonical IGDB URL. |
| FEATURED_VIDEO_URL | VARCHAR2(512) | Yes | Featured video URL from IGDB. |
| COLLECTION_ID | NUMBER | Yes | FK to `GAMEDB_COLLECTIONS`. |
| PARENT_IGDB_ID | NUMBER | Yes | Parent/series IGDB id (loose link). |
| PARENT_GAME_NAME | VARCHAR2(255) | Yes | Parent/series display name. |
| INITIAL_RELEASE_DATE | DATE | Yes | Earliest release date from `GAMEDB_RELEASES`. |
| CREATED_AT | TIMESTAMP | Yes | Defaults to `CURRENT_TIMESTAMP`. |
| UPDATED_AT | TIMESTAMP | Yes | Auto-updated via trigger. |

## GAMEDB_RELEASES

- Primary/unique constraints: `RELEASE_ID` primary key.
- Indexes: `IDX_GR_GAME` on `GAME_ID`; `IDX_GR_PLATFORM` on `PLATFORM_ID`;
  `IDX_GR_REGION` on `REGION_ID`.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| RELEASE_ID | NUMBER | No | Identity primary key. |
| GAME_ID | NUMBER | No | FK to `GAMEDB_GAMES`. |
| PLATFORM_ID | NUMBER | No | FK to `GAMEDB_PLATFORMS`. |
| REGION_ID | NUMBER | No | FK to `GAMEDB_REGIONS`. |
| FORMAT | VARCHAR2(20) | Yes | `Physical` or `Digital`. |
| RELEASE_DATE | DATE | Yes | Release date for region/platform. |
| NOTES | VARCHAR2(255) | Yes | Free-form notes. |

## GAMEDB_GAME_PLATFORMS

- Primary/unique constraints: composite primary key on `(GAME_ID, PLATFORM_ID)`.
- Indexes: `IDX_GGP_GAME` on `GAME_ID`; `IDX_GGP_PLATFORM` on `PLATFORM_ID`.
- Purpose: denormalized mapping of games to platforms for quick "available on" lookups.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| GAME_ID | NUMBER | No | FK to `GAMEDB_GAMES`. |
| PLATFORM_ID | NUMBER | No | FK to `GAMEDB_PLATFORMS`. |

## GAMEDB_GAME_ALTERNATES

- Primary/unique constraints: composite primary key on `(GAME_ID, ALT_GAME_ID)` with
  `CK_GAMEDB_GAME_ALTS_ORDER` enforcing `GAME_ID < ALT_GAME_ID`.
- Indexes: primary key; foreign keys to `GAMEDB_GAMES`.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| GAME_ID | NUMBER | No | Base GameDB id (smaller id in the pair). |
| ALT_GAME_ID | NUMBER | No | Alternate version GameDB id (larger id in the pair). |
| CREATED_AT | TIMESTAMP | No | Defaults to `CURRENT_TIMESTAMP`. |
| CREATED_BY | VARCHAR2(64) | Yes | Discord user id who linked the versions. |

## GAMEDB_SEARCH_SYNONYM_GROUPS

- Primary/unique constraints: `GROUP_ID` primary key.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| GROUP_ID | NUMBER | No | Identity primary key. |
| CREATED_AT | TIMESTAMP | No | Defaults to `CURRENT_TIMESTAMP`. |
| CREATED_BY | VARCHAR2(64) | Yes | Discord user id who created the group. |

## GAMEDB_SEARCH_SYNONYMS

- Primary/unique constraints: `TERM_ID` primary key; unique `(GROUP_ID, TERM_NORM)`.
- Indexes: `IDX_GAMEDB_SEARCH_SYNONYMS_GROUP` on `GROUP_ID`.
- Purpose: stores search synonym terms grouped for bidirectional matching.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| TERM_ID | NUMBER | No | Identity primary key. |
| GROUP_ID | NUMBER | No | FK to `GAMEDB_SEARCH_SYNONYM_GROUPS`. |
| TERM_TEXT | VARCHAR2(255) | No | Synonym or alternate text. |
| TERM_NORM | VARCHAR2(255) | No | Normalized text for search. |
| CREATED_AT | TIMESTAMP | No | Defaults to `CURRENT_TIMESTAMP`. |
| CREATED_BY | VARCHAR2(64) | Yes | Discord user id who added the term. |

## GAMEDB_SEARCH_SYNONYM_DRAFTS

- Primary/unique constraints: `DRAFT_ID` primary key.
- Purpose: stores in-progress synonym additions for admin modal flows.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| DRAFT_ID | NUMBER | No | Identity primary key. |
| USER_ID | VARCHAR2(64) | No | Discord user id who owns the draft. |
| PAIRS_JSON | CLOB | Yes | JSON array of pending pairs. |
| CREATED_AT | TIMESTAMP | No | Defaults to `CURRENT_TIMESTAMP`. |
| UPDATED_AT | TIMESTAMP | No | Updated on save. |

## GAMEDB_PLATFORMS

- Primary/unique constraints: `PLATFORM_ID` primary key; unique `PLATFORM_CODE`;
  unique `IGDB_PLATFORM_ID`.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| PLATFORM_ID | NUMBER | No | Identity primary key. |
| PLATFORM_CODE | VARCHAR2(20) | No | Short code (e.g., `SWITCH`, `PS5`). |
| PLATFORM_NAME | VARCHAR2(100) | No | Descriptive name. |
| IGDB_PLATFORM_ID | NUMBER | Yes | Unique IGDB platform id. |

## GAMEDB_REGIONS

- Primary/unique constraints: `REGION_ID` primary key; unique `REGION_CODE`;
  unique `IGDB_REGION_ID`.

| Column | Type | Nullable | Notes |
| --- | --- | --- | --- |
| REGION_ID | NUMBER | No | Identity primary key. |
| REGION_CODE | VARCHAR2(10) | No | Short code (e.g., `NA`, `EU`, `JP`). |
| REGION_NAME | VARCHAR2(100) | No | Descriptive name. |
| IGDB_REGION_ID | NUMBER | Yes | Unique IGDB region id. |

## Metadata lookup tables

- `GAMEDB_COMPANIES`, `GAMEDB_GENRES`, `GAMEDB_THEMES`, `GAMEDB_GAME_MODES_DEF`,
  `GAMEDB_PERSPECTIVES`, `GAMEDB_ENGINES`, `GAMEDB_FRANCHISES`, `GAMEDB_COLLECTIONS`
  each have an identity PK, `NAME` column, and unique `IGDB_*_ID`.

## Mapping tables

- `GAMEDB_GAME_COMPANIES` (`GAME_ID`, `COMPANY_ID`, `ROLE` check `Developer`/`Publisher`).
- `GAMEDB_GAME_GENRES`, `GAMEDB_GAME_THEMES`, `GAMEDB_GAME_MODES`,
  `GAMEDB_GAME_PERSPECTIVES`, `GAMEDB_GAME_ENGINES`, `GAMEDB_GAME_FRANCHISES`
  use composite PKs on `(GAME_ID, <lookup id>)` and FKs back to `GAMEDB_GAMES` and the
  respective lookup table.

## Seed data

- Regions: `NA`/2 North America, `EU`/1 Europe, `JP`/5 Japan, `WW`/8 Worldwide,
  `AUS`/3 Australia, `NZ`/4 New Zealand, `CN`/6 China, `AS`/7 Asia.
- Platforms: seeded with `SWITCH` (130), `PS5` (167), `PS4` (48), `PC` (6),
  `XBOX` (169). New platforms from IGDB are inserted automatically if missing.
