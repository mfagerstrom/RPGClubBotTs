# RPG_CLUB_PRESENCE_PROMPT_HISTORY table

Oracle table storing rich presence prompt history and response state.

## Structure

- **Primary key:** `PK_RPG_CLUB_PRESENCE_PROMPT_HISTORY` on `(PROMPT_ID)`
- **Index:** `IDX_RPG_CLUB_PRESENCE_PROMPT_HIST_USER` on `(USER_ID, GAME_TITLE_NORM, STATUS)`

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| PROMPT_ID | VARCHAR2(64) | No | — | Unique prompt id. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id. |
| GAME_TITLE | VARCHAR2(300) | No | — | Game title as prompted. |
| GAME_TITLE_NORM | VARCHAR2(300) | No | — | Normalized title for matching. |
| STATUS | VARCHAR2(20) | No | PENDING | PENDING, ACCEPTED, DECLINED, OPT_OUT_GAME, OPT_OUT_ALL. |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | Prompt creation time. |
| RESOLVED_AT | TIMESTAMP(6) WITH TIME ZONE | Yes | — | When the prompt was answered. |
