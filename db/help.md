# HELP table

Oracle table storing help topics and ordered info entries.

## Structure

- **Primary/unique constraints:** None reported.
- **Indexes:** `HELP_TOPIC_SEQ` on `(TOPIC, SEQ)`.
- **Triggers:** None reported.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| TOPIC | VARCHAR2(50) | No | — | Help topic identifier. |
| SEQ | NUMBER | No | — | Ordering within the topic. |
| INFO | VARCHAR2(80) | Yes | — | Help text content. |
