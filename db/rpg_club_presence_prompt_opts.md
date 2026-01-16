# RPG_CLUB_PRESENCE_PROMPT_OPTS table

Oracle table storing opt out preferences for now playing prompts from rich presence.

## Structure

- **Primary key:** `PK_RPG_CLUB_PRESENCE_PROMPT_OPTS` on `(USER_ID, SCOPE, GAME_TITLE_NORM)`
- **Indexes:** Primary key index only.
- **Constraints:** `CK_RPG_CLUB_PRESENCE_PROMPT_SCOPE` enforces `SCOPE` in `('ALL','GAME')`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| USER_ID | VARCHAR2(30) | No | — | Discord user id. |
| SCOPE | VARCHAR2(10) | No | — | `ALL` for global opt out, `GAME` for per title opt out. |
| GAME_TITLE | VARCHAR2(300) | Yes | — | Original game title, stored for reference. |
| GAME_TITLE_NORM | VARCHAR2(300) | No | — | Normalized title for matching. |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | Record creation timestamp. |
