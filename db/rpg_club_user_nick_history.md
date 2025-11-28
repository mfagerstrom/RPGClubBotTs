# RPG_CLUB_USER_NICK_HISTORY table

Oracle table tracking nickname changes for RPG Club users.

## Structure

- **Primary key:** `SYS_C008591` on `EVENT_ID`.
- **Indexes:** `IX_RPG_CLUB_USER_NICK_HISTORY_USER` on `(USER_ID, SYS_NC00006$)` (function-based for ordering by change time).
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| EVENT_ID | NUMBER | No | `"SYSTEM"."ISEQ$$_74191".nextval` | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | Discord user id. |
| OLD_NICK | VARCHAR2(100) | Yes | — | Previous nickname. |
| NEW_NICK | VARCHAR2(100) | Yes | — | New nickname. |
| CHANGED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | When the nickname change was captured. |
