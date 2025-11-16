-- Adds reminder tracking flags to BOT_VOTING_INFO so the bot knows which
-- automated nomination reminders were already delivered.
ALTER TABLE BOT_VOTING_INFO
  ADD (
    FIVE_DAY_REMINDER_SENT NUMBER(1) DEFAULT 0 NOT NULL,
    ONE_DAY_REMINDER_SENT NUMBER(1) DEFAULT 0 NOT NULL
  );

-- Existing rows receive the default value automatically, but run this update if
-- you created the columns without the DEFAULT clause.
UPDATE BOT_VOTING_INFO
   SET FIVE_DAY_REMINDER_SENT = NVL(FIVE_DAY_REMINDER_SENT, 0),
       ONE_DAY_REMINDER_SENT = NVL(ONE_DAY_REMINDER_SENT, 0);

COMMIT;
