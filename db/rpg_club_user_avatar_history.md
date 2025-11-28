# RPG_CLUB_USER_AVATAR_HISTORY table

Oracle table tracking avatar changes for RPG Club users.

## Structure

- **Primary key:** `SYS_C008595` on `EVENT_ID`.
- **Indexes:** `IX_RPG_CLUB_USER_AVATAR_HISTORY_USER` on `(USER_ID, SYS_NC00007$)` (function-based for ordering by change time).
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| EVENT_ID | NUMBER | No | `"SYSTEM"."ISEQ$$_74195".nextval` | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id. |
| AVATAR_HASH | VARCHAR2(128) | Yes | — | Hash of the avatar, if provided. |
| AVATAR_URL | VARCHAR2(512) | Yes | — | URL of the avatar image. |
| AVATAR_BLOB | BLOB | Yes | — | Avatar image bytes. |
| CHANGED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | When the avatar change was captured. |
