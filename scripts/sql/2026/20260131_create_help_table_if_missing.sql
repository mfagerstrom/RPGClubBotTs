-- Create HELP table if it does not already exist.

declare
  v_count number := 0;
begin
  select count(*)
    into v_count
    from user_objects
   where object_name = 'HELP'
     and object_type = 'TABLE';

  if v_count = 0 then
    execute immediate q'[
      CREATE TABLE HELP (
        TOPIC VARCHAR2(50) NOT NULL,
        SEQ NUMBER NOT NULL,
        INFO VARCHAR2(80),
        CONSTRAINT PK_HELP PRIMARY KEY (TOPIC, SEQ)
      )
    ]';

    execute immediate q'[
      CREATE INDEX HELP_TOPIC_SEQ ON HELP (TOPIC, SEQ)
    ]';
  end if;
end;
/
