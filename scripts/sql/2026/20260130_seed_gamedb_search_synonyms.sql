DECLARE
  PROCEDURE ensure_group(p_terms SYS.ODCIVARCHAR2LIST) IS
    v_group_id NUMBER;
    v_exists NUMBER;
  BEGIN
    INSERT INTO GAMEDB_SEARCH_SYNONYM_GROUPS (CREATED_BY)
    VALUES ('seed')
    RETURNING GROUP_ID INTO v_group_id;

    FOR i IN 1 .. p_terms.COUNT LOOP
      SELECT COUNT(*)
        INTO v_exists
        FROM GAMEDB_SEARCH_SYNONYMS
       WHERE GROUP_ID = v_group_id
         AND TERM_NORM = REGEXP_REPLACE(LOWER(p_terms(i)), '[^a-z0-9]', '');
      IF v_exists = 0 THEN
        INSERT INTO GAMEDB_SEARCH_SYNONYMS (GROUP_ID, TERM_TEXT, TERM_NORM, CREATED_BY)
        VALUES (
          v_group_id,
          p_terms(i),
          REGEXP_REPLACE(LOWER(p_terms(i)), '[^a-z0-9]', ''),
          'seed'
        );
      END IF;
    END LOOP;
  END;

  FUNCTION number_to_word(p_num NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE p_num
      WHEN 1 THEN 'one'
      WHEN 2 THEN 'two'
      WHEN 3 THEN 'three'
      WHEN 4 THEN 'four'
      WHEN 5 THEN 'five'
      WHEN 6 THEN 'six'
      WHEN 7 THEN 'seven'
      WHEN 8 THEN 'eight'
      WHEN 9 THEN 'nine'
      WHEN 10 THEN 'ten'
      WHEN 11 THEN 'eleven'
      WHEN 12 THEN 'twelve'
      WHEN 13 THEN 'thirteen'
      WHEN 14 THEN 'fourteen'
      WHEN 15 THEN 'fifteen'
      WHEN 16 THEN 'sixteen'
      WHEN 17 THEN 'seventeen'
      WHEN 18 THEN 'eighteen'
      WHEN 19 THEN 'nineteen'
      WHEN 20 THEN 'twenty'
      ELSE NULL
    END;
  END;

  FUNCTION to_roman(p_num NUMBER) RETURN VARCHAR2 IS
    v_num NUMBER := p_num;
    v_result VARCHAR2(100) := '';
    TYPE t_num_tab IS TABLE OF NUMBER;
    TYPE t_str_tab IS TABLE OF VARCHAR2(10);
    v_nums t_num_tab := t_num_tab(100, 90, 50, 40, 10, 9, 5, 4, 1);
    v_strs t_str_tab := t_str_tab('C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I');
  BEGIN
    IF v_num < 1 OR v_num > 100 THEN
      RETURN NULL;
    END IF;
    FOR i IN 1 .. v_nums.COUNT LOOP
      WHILE v_num >= v_nums(i) LOOP
        v_result := v_result || v_strs(i);
        v_num := v_num - v_nums(i);
      END LOOP;
    END LOOP;
    RETURN v_result;
  END;
BEGIN
  FOR i IN 1 .. 100 LOOP
    IF i <= 20 THEN
      ensure_group(
        SYS.ODCIVARCHAR2LIST(
          TO_CHAR(i),
          to_roman(i),
          number_to_word(i)
        )
      );
    ELSE
      ensure_group(
        SYS.ODCIVARCHAR2LIST(
          TO_CHAR(i),
          to_roman(i)
        )
      );
    END IF;
  END LOOP;

  ensure_group(SYS.ODCIVARCHAR2LIST('FF', 'Final Fantasy'));
  ensure_group(SYS.ODCIVARCHAR2LIST('GTA', 'Grand Theft Auto'));
  ensure_group(SYS.ODCIVARCHAR2LIST('DQ', 'Dragon Quest'));
  ensure_group(SYS.ODCIVARCHAR2LIST('AC', 'Animal Crossing'));
  ensure_group(SYS.ODCIVARCHAR2LIST('AC', 'Asheron''s Call'));
  ensure_group(SYS.ODCIVARCHAR2LIST('AC', 'Assassin''s Creed'));
END;
/
