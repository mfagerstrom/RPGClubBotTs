DECLARE
  v_constraint_name user_constraints.constraint_name%TYPE;
BEGIN
  SELECT uc.constraint_name
    INTO v_constraint_name
    FROM user_constraints uc
    JOIN user_cons_columns ucc
      ON uc.constraint_name = ucc.constraint_name
     AND uc.table_name = ucc.table_name
   WHERE uc.table_name = 'GAMEDB_GAMES'
     AND uc.constraint_type = 'U'
     AND ucc.column_name = 'TITLE'
     AND ucc.position = 1;

  EXECUTE IMMEDIATE 'ALTER TABLE GAMEDB_GAMES DROP CONSTRAINT ' || v_constraint_name;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    NULL;
END;
/
