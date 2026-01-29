# RPG_CLUB_SUGGESTIONS table

Oracle table storing user-submitted bot suggestions.

## Structure

- **Primary/unique constraints:** `SUGGESTION_ID` primary key (identity).
- **Indexes:** `IX_RPG_CLUB_SUGGESTIONS_CREATED` on `(CREATED_AT)`.
- **Triggers:** `TRG_RPG_CLUB_SUGGESTIONS_UPD` updates `UPDATED_AT`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| SUGGESTION_ID | NUMBER | No | Identity | Primary key. |
| TITLE | VARCHAR2(200) | No | — | Short suggestion title. |
| DETAILS | VARCHAR2(2000) | Yes | — | Optional details/notes. |
| LABELS | VARCHAR2(200) | Yes | — | Optional GitHub labels (comma-separated). |
| CREATED_BY | VARCHAR2(30) | Yes | — | Discord user id of creator. |
| CREATED_BY_NAME | VARCHAR2(100) | Yes | — | Discord username of creator. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edit. |
