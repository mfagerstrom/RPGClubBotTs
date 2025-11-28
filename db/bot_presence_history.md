# BOT_PRESENCE_HISTORY table

Oracle table tracking bot presence/activity changes.

## Structure

- **Primary/unique constraints:** None reported in data dictionary.
- **Indexes:** `SYS_C008539` on `ID`; `IX_BOT_PRESENCE_HISTORY_SET_AT` (function-based, column `SYS_NC00006$` for `SET_AT` ordering).
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| ID | NUMBER | No | `"SYSTEM"."ISEQ$$_72460".nextval` | Identifier; indexed. |
| ACTIVITY_NAME | VARCHAR2(1020) | No | — | Activity/presence text set on the bot. |
| SET_AT | TIMESTAMP(6) | No | SYSTIMESTAMP | When the presence was set. |
| SET_BY_USER_ID | VARCHAR2(128) | Yes | — | Discord user id of the setter. |
| SET_BY_USERNAME | VARCHAR2(256) | Yes | — | Username of the setter. |
