# RPG_CLUB_USER_ACTIVITY_ICONS table

Oracle table storing user activity icon references captured from presence updates.

## Structure

- **Primary key:** `PK_RPG_CLUB_USER_ACTIVITY_ICONS` on `(ID)`
- **Unique constraint:** `UQ_RPG_CLUB_USER_ACTIVITY_ICONS_REF` on
  `(USER_ID, ACTIVITY_NAME_NORM, ICON_TYPE, SOURCE_REF)`
- **Index:** `IDX_RPG_CLUB_USER_ACTIVITY_ICONS_LOOKUP` on
  `(USER_ID, LAST_SEEN_AT, ACTIVITY_NAME_NORM, ICON_TYPE)`

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ID | NUMBER | No | Identity | Row identifier. |
| USER_ID | VARCHAR2(128) | No | — | Discord user id for the activity owner. |
| USERNAME | VARCHAR2(256) | Yes | — | Last seen username at snapshot time. |
| ACTIVITY_NAME | VARCHAR2(256) | No | — | Display name of the activity. |
| ACTIVITY_NAME_NORM | VARCHAR2(256) | No | — | Normalized activity name for matching. |
| ICON_TYPE | VARCHAR2(16) | No | — | `large` or `small`. |
| SOURCE_REF | VARCHAR2(1024) | No | — | Stable source key from activity asset data. |
| ICON_URL | VARCHAR2(2048) | No | — | Icon URL used for retrieval. |
| FIRST_SEEN_AT | TIMESTAMP | No | SYSTIMESTAMP | First observed timestamp. |
| LAST_SEEN_AT | TIMESTAMP | No | SYSTIMESTAMP | Most recent observed timestamp. |
| SEEN_COUNT | NUMBER | No | 1 | Number of times this source was observed. |
