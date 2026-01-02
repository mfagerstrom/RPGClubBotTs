# RPG_CLUB_TODOS table

Oracle table storing bot development TODO items managed by server owner commands.

## Structure

- **Primary/unique constraints:** `TODO_ID` primary key (identity).
- **Indexes:** `IX_RPG_CLUB_TODOS_STATUS` on `(IS_COMPLETED, CREATED_AT)`.
- **Triggers:** `TRG_RPG_CLUB_TODOS_UPD` updates `UPDATED_AT`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| TODO_ID | NUMBER | No | Identity | Primary key. |
| TITLE | VARCHAR2(200) | No | — | Short TODO title. |
| DETAILS | VARCHAR2(2000) | Yes | — | Optional details/notes. |
| CREATED_BY | VARCHAR2(30) | Yes | — | Discord user id of creator. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edit. |
| COMPLETED_AT | TIMESTAMP WITH TIME ZONE | Yes | — | Completion timestamp. |
| COMPLETED_BY | VARCHAR2(30) | Yes | — | Discord user id who completed it. |
| IS_COMPLETED | NUMBER(1,0) | No | 0 | Completion flag. |
