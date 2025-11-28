# BOT_VOTING_INFO table

Oracle table storing vote scheduling and reminder flags for rounds.

## Structure

- **Primary/unique constraints:** None reported.
- **Indexes:** `SYS_C008546` on `ROUND_NUMBER`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ROUND_NUMBER | NUMBER(10,0) | No | — | Voting round identifier; indexed. |
| NOMINATION_LIST_ID | NUMBER(10,0) | Yes | — | Reference to nomination list entry. |
| NEXT_VOTE_AT | DATE | No | — | Scheduled date of the next vote. |
| FIVE_DAY_REMINDER_SENT | NUMBER(1,0) | No | 0 | Flag indicating 5-day reminder sent. |
| ONE_DAY_REMINDER_SENT | NUMBER(1,0) | No | 0 | Flag indicating 1-day reminder sent. |
