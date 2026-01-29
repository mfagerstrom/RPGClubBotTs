-- Add SERVER_LEFT_AT to track when a member departs the server
ALTER TABLE RPG_CLUB_USERS
  ADD (
    SERVER_LEFT_AT TIMESTAMP(6) WITH TIME ZONE NULL
  );
