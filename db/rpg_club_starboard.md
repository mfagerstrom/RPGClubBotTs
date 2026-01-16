# RPG_CLUB_STARBOARD table

Oracle table storing starboard entries for quoted messages.

## Structure

- **Primary key:** `PK_RPG_CLUB_STARBOARD` on `(MESSAGE_ID)`
- **Indexes:** Primary key index only.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| MESSAGE_ID | VARCHAR2(30) | No | — | Original message id. |
| CHANNEL_ID | VARCHAR2(30) | No | — | Channel id where the original message lives. |
| STARBOARD_MESSAGE_ID | VARCHAR2(30) | No | — | Message id in the quotables channel. |
| AUTHOR_ID | VARCHAR2(30) | No | — | Original message author. |
| STAR_COUNT | NUMBER(5,0) | No | 0 | Stars at time of posting. |
| CREATED_AT | TIMESTAMP(6) WITH TIME ZONE | No | SYSTIMESTAMP | Insert time. |
