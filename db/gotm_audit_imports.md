# RPG_CLUB_GOTM_AUDIT_IMPORTS table

Tracks GOTM audit import sessions.

## Structure

- **Primary/unique constraints:** `RPG_CLUB_GOTM_AUDIT_IMPORTS` primary key on `IMPORT_ID`.
- **Indexes:** `IX_GOTM_AUDIT_IMPORTS_USER` on `(USER_ID, STATUS)`.
- **Triggers:** `TRG_GOTM_AUDIT_IMPORTS_UPD` updates `UPDATED_AT` on row updates.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| IMPORT_ID | NUMBER | No | Identity | Primary key. |
| USER_ID | VARCHAR2(30) | No | — | User who started the audit. |
| STATUS | VARCHAR2(20) | No | — | ACTIVE, PAUSED, COMPLETED, or CANCELED. |
| CURRENT_INDEX | NUMBER | No | 0 | Last processed row index. |
| TOTAL_COUNT | NUMBER | No | 0 | Total rows in the audit import. |
| SOURCE_FILENAME | VARCHAR2(255) | Yes | — | Original CSV filename. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated timestamp. |
