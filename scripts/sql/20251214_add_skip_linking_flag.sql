-- Add skip flag so the bot can avoid re-prompting threads intentionally left unlinked.

ALTER TABLE THREADS
  ADD (SKIP_LINKING CHAR(1) DEFAULT 'N' CHECK (SKIP_LINKING IN ('Y','N')));

COMMIT;
