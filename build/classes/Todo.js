import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function mapTodoRow(row) {
    return {
        todoId: Number(row.TODO_ID),
        title: row.TITLE,
        details: row.DETAILS ?? null,
        todoCategory: row.TODO_CATEGORY ?? null,
        todoSize: row.TODO_SIZE ?? null,
        createdBy: row.CREATED_BY ?? null,
        createdAt: toDate(row.CREATED_AT),
        updatedAt: toDate(row.UPDATED_AT),
        completedAt: row.COMPLETED_AT ? toDate(row.COMPLETED_AT) : null,
        completedBy: row.COMPLETED_BY ?? null,
        isCompleted: (row.IS_COMPLETED ?? 0) === 1,
    };
}
export async function fetchTodoById(todoId, existingConnection) {
    const connection = existingConnection ?? (await getOraclePool().getConnection());
    try {
        const result = await connection.execute(`SELECT TODO_ID,
              TITLE,
              DETAILS,
              TODO_CATEGORY,
              TODO_SIZE,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT,
              COMPLETED_AT,
              COMPLETED_BY,
              IS_COMPLETED
         FROM RPG_CLUB_TODOS
        WHERE TODO_ID = :id`, { id: todoId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = result.rows?.[0];
        return row ? mapTodoRow(row) : null;
    }
    finally {
        if (!existingConnection) {
            await connection.close();
        }
    }
}
export async function createTodo(title, details, todoCategory, todoSize, createdBy) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`INSERT INTO RPG_CLUB_TODOS (TITLE, DETAILS, TODO_CATEGORY, TODO_SIZE, CREATED_BY)
       VALUES (:title, :details, :todoCategory, :todoSize, :createdBy)
       RETURNING TODO_ID INTO :id`, {
            title,
            details,
            todoCategory,
            todoSize,
            createdBy,
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }, { autoCommit: true });
        const id = Number(result.outBinds?.id?.[0] ?? 0);
        if (!id) {
            throw new Error("Failed to create TODO.");
        }
        const todo = await fetchTodoById(id, connection);
        if (!todo) {
            throw new Error("Failed to load TODO after creation.");
        }
        return todo;
    }
    finally {
        await connection.close();
    }
}
export async function listTodos(includeCompleted, limit = 100) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const connection = await getOraclePool().getConnection();
    try {
        const whereClause = includeCompleted ? "" : "WHERE IS_COMPLETED = 0";
        const result = await connection.execute(`SELECT TODO_ID,
              TITLE,
              DETAILS,
              TODO_CATEGORY,
              TODO_SIZE,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT,
              COMPLETED_AT,
              COMPLETED_BY,
              IS_COMPLETED
         FROM RPG_CLUB_TODOS
         ${whereClause}
        ORDER BY IS_COMPLETED ASC, CREATED_AT ASC
        FETCH FIRST :limit ROWS ONLY`, { limit: safeLimit }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        return (result.rows ?? []).map((row) => mapTodoRow(row));
    }
    finally {
        await connection.close();
    }
}
export async function updateTodo(todoId, title, details, todoCategory, todoSize) {
    const connection = await getOraclePool().getConnection();
    try {
        const titleProvided = title !== undefined ? 1 : 0;
        const detailsProvided = details !== undefined ? 1 : 0;
        const categoryProvided = todoCategory !== undefined ? 1 : 0;
        const sizeProvided = todoSize !== undefined ? 1 : 0;
        const result = await connection.execute(`UPDATE RPG_CLUB_TODOS
          SET TITLE = CASE WHEN :titleProvided = 1 THEN :title ELSE TITLE END,
              DETAILS = CASE WHEN :detailsProvided = 1 THEN :details ELSE DETAILS END,
              TODO_CATEGORY = CASE
                WHEN :categoryProvided = 1 THEN :todoCategory
                ELSE TODO_CATEGORY
              END,
              TODO_SIZE = CASE
                WHEN :sizeProvided = 1 THEN :todoSize
                ELSE TODO_SIZE
              END
        WHERE TODO_ID = :id`, {
            id: todoId,
            title,
            details,
            todoCategory,
            todoSize,
            titleProvided,
            detailsProvided,
            categoryProvided,
            sizeProvided,
        }, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
export async function deleteTodo(todoId) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`DELETE FROM RPG_CLUB_TODOS WHERE TODO_ID = :id`, { id: todoId }, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
export async function completeTodo(todoId, completedBy) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`UPDATE RPG_CLUB_TODOS
          SET IS_COMPLETED = 1,
              COMPLETED_AT = SYSTIMESTAMP,
              COMPLETED_BY = :completedBy
        WHERE TODO_ID = :id
          AND IS_COMPLETED = 0`, { id: todoId, completedBy }, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
export async function countTodos() {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
              SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT
         FROM RPG_CLUB_TODOS`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = result.rows?.[0];
        return {
            open: Number(row?.OPEN_COUNT ?? 0),
            completed: Number(row?.COMPLETED_COUNT ?? 0),
        };
    }
    finally {
        await connection.close();
    }
}
export async function countTodoSummary() {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`SELECT SUM(CASE WHEN IS_COMPLETED = 1 THEN 0 ELSE 1 END) AS OPEN_COUNT,
              SUM(CASE WHEN IS_COMPLETED = 1 THEN 1 ELSE 0 END) AS COMPLETED_COUNT,
              SUM(
                CASE
                  WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'New Features' THEN 1
                  ELSE 0
                END
              ) AS OPEN_NEW_FEATURES,
              SUM(
                CASE
                  WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Improvements' THEN 1
                  ELSE 0
                END
              ) AS OPEN_IMPROVEMENTS,
              SUM(
                CASE
                  WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Defects' THEN 1
                  ELSE 0
                END
              ) AS OPEN_DEFECTS,
              SUM(
                CASE
                  WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Blocked' THEN 1
                  ELSE 0
                END
              ) AS OPEN_BLOCKED,
              SUM(
                CASE
                  WHEN IS_COMPLETED = 0 AND TODO_CATEGORY = 'Refactoring' THEN 1
                  ELSE 0
                END
              ) AS OPEN_REFACTORING
         FROM RPG_CLUB_TODOS`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = result.rows?.[0];
        return {
            open: Number(row?.OPEN_COUNT ?? 0),
            completed: Number(row?.COMPLETED_COUNT ?? 0),
            openByCategory: {
                newFeatures: Number(row?.OPEN_NEW_FEATURES ?? 0),
                improvements: Number(row?.OPEN_IMPROVEMENTS ?? 0),
                defects: Number(row?.OPEN_DEFECTS ?? 0),
                blocked: Number(row?.OPEN_BLOCKED ?? 0),
                refactoring: Number(row?.OPEN_REFACTORING ?? 0),
            },
        };
    }
    finally {
        await connection.close();
    }
}
