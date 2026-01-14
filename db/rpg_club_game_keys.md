# RPG_CLUB_GAME_KEYS table

Oracle table storing donated game keys for giveaways.

## Structure

- **Primary/unique constraints:** `KEY_ID` primary key (identity).
- **Indexes:** `IX_GAME_KEYS_TITLE` on `(GAME_TITLE)`, `IX_GAME_KEYS_AVAILABLE` on `(CLAIMED_BY_USER_ID, GAME_TITLE)`.
- **Triggers:** `TRG_RPG_CLUB_GAME_KEYS_UPD` updates `UPDATED_AT`.

## Columns

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| KEY_ID | NUMBER | No | Identity | Primary key. |
| GAME_TITLE | VARCHAR2(200) | No | — | Game title as provided by donor. |
| PLATFORM | VARCHAR2(50) | No | — | Digital platform (Steam, Epic, GOG, etc). |
| KEY_VALUE | VARCHAR2(200) | No | — | Redeemable key. |
| DONOR_USER_ID | VARCHAR2(30) | No | — | Discord user id of donor. |
| CLAIMED_BY_USER_ID | VARCHAR2(30) | Yes | — | Discord user id of claimant. |
| CLAIMED_AT | TIMESTAMP WITH TIME ZONE | Yes | — | Timestamp when claimed. |
| CREATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Creation timestamp. |
| UPDATED_AT | TIMESTAMP WITH TIME ZONE | No | SYSTIMESTAMP | Updated on edit. |
