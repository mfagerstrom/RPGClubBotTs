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
        createdBy: row.CREATED_BY ?? null,
        createdAt: toDate(row.CREATED_AT),
        updatedAt: toDate(row.UPDATED_AT),
        completedAt: row.COMPLETED_AT ? toDate(row.COMPLETED_AT) : null,
        completedBy: row.COMPLETED_BY ?? null,
        isCompleted: (row.IS_COMPLETED ?? 0) === 1,
    };
}
async function fetchTodoById(todoId, existingConnection) {
    const connection = existingConnection ?? (await getOraclePool().getConnection());
    try {
        const result = await connection.execute(`SELECT TODO_ID,
              TITLE,
              DETAILS,
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
export async function createTodo(title, details, createdBy) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`INSERT INTO RPG_CLUB_TODOS (TITLE, DETAILS, CREATED_BY)
       VALUES (:title, :details, :createdBy)
       RETURNING TODO_ID INTO :id`, {
            title,
            details,
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
export async function updateTodo(todoId, title, details) {
    const connection = await getOraclePool().getConnection();
    try {
        const titleProvided = title !== undefined ? 1 : 0;
        const detailsProvided = details !== undefined ? 1 : 0;
        const result = await connection.execute(`UPDATE RPG_CLUB_TODOS
          SET TITLE = CASE WHEN :titleProvided = 1 THEN :title ELSE TITLE END,
              DETAILS = CASE WHEN :detailsProvided = 1 THEN :details ELSE DETAILS END
        WHERE TODO_ID = :id`, {
            id: todoId,
            title,
            details,
            titleProvided,
            detailsProvided,
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
