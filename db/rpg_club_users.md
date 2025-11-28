# RPG_CLUB_USERS table

Oracle table for storing RPG Club Discord user snapshots and role flags.

## Structure

- **Primary key:** `USER_ID`
- **Index:** `SYS_C008571` on `USER_ID`
- **Triggers:** `TRG_RPG_CLUB_USERS_UPD` (UPDATE), `TRG_RPG_CLUB_USERS_NICK_HIST`
  (UPDATE), `TRG_RPG_CLUB_USERS_AVATAR_HIST` (UPDATE)

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| USER_ID | VARCHAR2(30) | No | — | Discord user id; primary key. |
| IS_BOT | NUMBER(1,0) | No | 0 | 1 if the account is a bot. |
| USERNAME | VARCHAR2(100) | Yes | — | Latest username recorded. |
| GLOBAL_NAME | VARCHAR2(100) | Yes | — | Latest global display name. |
| AVATAR_BLOB | BLOB | Yes | — | Latest avatar image bytes. |
| SERVER_JOINED_AT | TIMESTAMP(6) WITH TIME ZONE | Yes | — | When the user joined. |
| LAST_SEEN_AT | TIMESTAMP(6) WITH TIME ZONE | Yes | — | Last message or activity seen. |
| LAST_FETCHED_AT | TIMESTAMP(6) WITH TIME ZONE | Yes | — | Last time the record was fetched. |
| ROLE_ADMIN | NUMBER(1,0) | No | 0 | Admin role flag. |
| ROLE_MODERATOR | NUMBER(1,0) | No | 0 | Moderator role flag. |
| ROLE_REGULAR | NUMBER(1,0) | No | 0 | Regular role flag. |
| ROLE_MEMBER | NUMBER(1,0) | No | 0 | Member role flag. |
| ROLE_NEWCOMER | NUMBER(1,0) | No | 0 | Newcomer role flag. |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | Record creation timestamp. |
| UPDATED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | Last update timestamp. |
| MESSAGE_COUNT | NUMBER(10,0) | Yes | 0 | Cached message count, nullable. |
| COMPLETIONATOR_URL | VARCHAR2(512) | Yes | — | Link to Completionator profile. |
| PSN_USERNAME | VARCHAR2(100) | Yes | — | PlayStation Network username. |
| XBL_USERNAME | VARCHAR2(100) | Yes | — | Xbox Live username. |
| NSW_FRIEND_CODE | VARCHAR2(50) | Yes | — | Nintendo Switch friend code. |
| STEAM_URL | VARCHAR2(512) | Yes | — | Link to Steam profile. |
