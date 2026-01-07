import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface ITodoItem {
  todoId: number;
  title: string;
  details: string | null;
  todoCategory: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  completedBy: string | null;
  isCompleted: boolean;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapTodoRow(row: {
  TODO_ID: number;
  TITLE: string;
  DETAILS: string | null;
  TODO_CATEGORY: string | null;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
  COMPLETED_AT: Date | string | null;
  COMPLETED_BY: string | null;
  IS_COMPLETED: number;
}): ITodoItem {
  return {
    todoId: Number(row.TODO_ID),
    title: row.TITLE,
    details: row.DETAILS ?? null,
    todoCategory: row.TODO_CATEGORY ?? null,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
    completedAt: row.COMPLETED_AT ? toDate(row.COMPLETED_AT) : null,
    completedBy: row.COMPLETED_BY ?? null,
    isCompleted: (row.IS_COMPLETED ?? 0) === 1,
  };
}

export async function fetchTodoById(
  todoId: number,
  existingConnection?: oracledb.Connection,
): Promise<ITodoItem | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<{
      TODO_ID: number;
      TITLE: string;
      DETAILS: string | null;
      TODO_CATEGORY: string | null;
      CREATED_BY: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
      COMPLETED_AT: Date | string | null;
      COMPLETED_BY: string | null;
      IS_COMPLETED: number;
    }>(
      `SELECT TODO_ID,
              TITLE,
              DETAILS,
              TODO_CATEGORY,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT,
              COMPLETED_AT,
              COMPLETED_BY,
              IS_COMPLETED
         FROM RPG_CLUB_TODOS
        WHERE TODO_ID = :id`,
      { id: todoId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const row = result.rows?.[0];
    return row ? mapTodoRow(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function createTodo(
  title: string,
  details: string | null,
  todoCategory: string | null,
  createdBy: string | null,
): Promise<ITodoItem> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_TODOS (TITLE, DETAILS, TODO_CATEGORY, CREATED_BY)
       VALUES (:title, :details, :todoCategory, :createdBy)
       RETURNING TODO_ID INTO :id`,
      {
        title,
        details,
        todoCategory,
        createdBy,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create TODO.");
    }
    const todo = await fetchTodoById(id, connection);
    if (!todo) {
      throw new Error("Failed to load TODO after creation.");
    }
    return todo;
  } finally {
    await connection.close();
  }
}

export async function listTodos(
  includeCompleted: boolean,
  limit: number = 100,
): Promise<ITodoItem[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const connection = await getOraclePool().getConnection();
  try {
    const whereClause = includeCompleted ? "" : "WHERE IS_COMPLETED = 0";
    const result = await connection.execute<{
      TODO_ID: number;
      TITLE: string;
      DETAILS: string | null;
      TODO_CATEGORY: string | null;
      CREATED_BY: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
      COMPLETED_AT: Date | string | null;
      COMPLETED_BY: string | null;
      IS_COMPLETED: number;
    }>(
      `SELECT TODO_ID,
              TITLE,
              DETAILS,
              TODO_CATEGORY,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT,
              COMPLETED_AT,
              COMPLETED_BY,
              IS_COMPLETED
         FROM RPG_CLUB_TODOS
         ${whereClause}
        ORDER BY IS_COMPLETED ASC, CREATED_AT ASC
        FETCH FIRST :limit ROWS ONLY`,
      { limit: safeLimit },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return (result.rows ?? []).map((row) => mapTodoRow(row));
  } finally {
    await connection.close();
  }
}

export async function updateTodo(
  todoId: number,
  title: string | null | undefined,
  details: string | null | undefined,
  todoCategory: string | null | undefined,
): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const titleProvided = title !== undefined ? 1 : 0;
    const detailsProvided = details !== undefined ? 1 : 0;
    const categoryProvided = todoCategory !== undefined ? 1 : 0;
    const result = await connection.execute(
      `UPDATE RPG_CLUB_TODOS
          SET TITLE = CASE WHEN :titleProvided = 1 THEN :title ELSE TITLE END,
              DETAILS = CASE WHEN :detailsProvided = 1 THEN :details ELSE DETAILS END,
              TODO_CATEGORY = CASE
                WHEN :categoryProvided = 1 THEN :todoCategory
                ELSE TODO_CATEGORY
              END
        WHERE TODO_ID = :id`,
      {
        id: todoId,
        title,
        details,
        todoCategory,
        titleProvided,
        detailsProvided,
        categoryProvided,
      },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function deleteTodo(todoId: number): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM RPG_CLUB_TODOS WHERE TODO_ID = :id`,
      { id: todoId },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function completeTodo(todoId: number, completedBy: string | null): Promise<boolean> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `UPDATE RPG_CLUB_TODOS
          SET IS_COMPLETED = 1,
              COMPLETED_AT = SYSTIMESTAMP,
              COMPLETED_BY = :completedBy
        WHERE TODO_ID = :id
          AND IS_COMPLETED = 0`,
      { id: todoId, completedBy },
      { autoCommit: true },
    );
    return (result.rowsAffected ?? 0) > 0;
  } finally {
    await connection.close();
  }
}

export async function countTodos(): Promise<{ open: number; completed: number }> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      OPEN_COUNT: number | null;
      COMPLETED_COUNT: number | null;
    }>(
      `SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
              SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT
         FROM RPG_CLUB_TODOS`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return {
      open: Number(row?.OPEN_COUNT ?? 0),
      completed: Number(row?.COMPLETED_COUNT ?? 0),
    };
  } finally {
    await connection.close();
  }
}
