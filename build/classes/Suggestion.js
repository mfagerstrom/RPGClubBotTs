import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function mapSuggestionRow(row) {
    return {
        suggestionId: Number(row.SUGGESTION_ID),
        title: row.TITLE,
        details: row.DETAILS ?? null,
        createdBy: row.CREATED_BY ?? null,
        createdAt: toDate(row.CREATED_AT),
        updatedAt: toDate(row.UPDATED_AT),
    };
}
export async function createSuggestion(title, details, createdBy) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`INSERT INTO RPG_CLUB_SUGGESTIONS (TITLE, DETAILS, CREATED_BY)
       VALUES (:title, :details, :createdBy)
       RETURNING SUGGESTION_ID INTO :id`, {
            title,
            details,
            createdBy,
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }, { autoCommit: true });
        const id = Number(result.outBinds?.id?.[0] ?? 0);
        if (!id) {
            throw new Error("Failed to create suggestion.");
        }
        const suggestion = await getSuggestionById(id, connection);
        if (!suggestion) {
            throw new Error("Failed to load suggestion after creation.");
        }
        return suggestion;
    }
    finally {
        await connection.close();
    }
}
export async function listSuggestions(limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`SELECT SUGGESTION_ID,
              TITLE,
              DETAILS,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_SUGGESTIONS
        ORDER BY CREATED_AT DESC, SUGGESTION_ID DESC
        FETCH FIRST :limit ROWS ONLY`, { limit: safeLimit }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        return (result.rows ?? []).map((row) => mapSuggestionRow(row));
    }
    finally {
        await connection.close();
    }
}
export async function countSuggestions() {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute("SELECT COUNT(*) AS TOTAL FROM RPG_CLUB_SUGGESTIONS", {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = result.rows?.[0];
        return Number(row?.TOTAL ?? 0);
    }
    finally {
        await connection.close();
    }
}
export async function getSuggestionById(suggestionId, existingConnection) {
    const connection = existingConnection ?? (await getOraclePool().getConnection());
    try {
        const result = await connection.execute(`SELECT SUGGESTION_ID,
              TITLE,
              DETAILS,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_SUGGESTIONS
        WHERE SUGGESTION_ID = :id`, { id: suggestionId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = result.rows?.[0];
        return row ? mapSuggestionRow(row) : null;
    }
    finally {
        if (!existingConnection) {
            await connection.close();
        }
    }
}
export async function deleteSuggestion(suggestionId) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`DELETE FROM RPG_CLUB_SUGGESTIONS WHERE SUGGESTION_ID = :id`, { id: suggestionId }, { autoCommit: true });
        return (result.rowsAffected ?? 0) > 0;
    }
    finally {
        await connection.close();
    }
}
