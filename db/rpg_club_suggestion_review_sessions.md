# RPG_CLUB_SUGGESTION_REVIEW_SESSIONS table

Persists /suggestion-review sessions so reviewers can resume in-progress queues after restarts.

## Structure

- **Primary/unique constraints:** `SESSION_ID` primary key.
- **Indexes:** `IX_RPG_CLUB_SUG_REV_SESS_REVIEWER` on `(REVIEWER_ID)`, `IX_RPG_CLUB_SUG_REV_SESS_CREATED` on `(CREATED_AT)`.
- **Triggers:** `TRG_RPG_CLUB_SUG_REV_SESS_UPD` updates `UPDATED_AT`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| SESSION_ID | VARCHAR2(120) | No | — | Stable session identifier for the review flow. |
| REVIEWER_ID | VARCHAR2(30) | No | — | Discord user id of the reviewer. |
| SUGGESTION_IDS | VARCHAR2(4000) | No | — | JSON array of suggestion ids and order for the session. |
| CURRENT_INDEX | NUMBER | No | 0 | Zero-based index into `SUGGESTION_IDS`. |
| TOTAL_COUNT | NUMBER | No | 0 | Total pending suggestions when the session started. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Session creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edit. |
