SELECT column_id, column_name, data_type, data_length, data_precision, data_scale,
       nullable, data_default
FROM   all_tab_columns
WHERE  table_name = 'GOTM_NOMINATIONS'
ORDER  BY column_id;

SELECT c.constraint_name, c.r_constraint_name AS referenced_constraint,
       cc.column_name, rc.table_name AS referenced_table
FROM   all_constraints c
JOIN   all_cons_columns cc
  ON   c.owner = cc.owner AND c.constraint_name = cc.constraint_name
JOIN   all_constraints rc
  ON   rc.owner = c.owner AND rc.constraint_name = c.r_constraint_name
WHERE  c.table_name = 'GOTM_NOMINATIONS'
AND    c.constraint_type = 'R'
ORDER  BY c.constraint_name, cc.position;

SELECT index_name, column_name, column_position
FROM   all_ind_columns
WHERE  table_name = 'GOTM_NOMINATIONS'
ORDER  BY index_name, column_position;

SELECT trigger_name, triggering_event, status
FROM   all_triggers
WHERE  table_name = 'GOTM_NOMINATIONS';



