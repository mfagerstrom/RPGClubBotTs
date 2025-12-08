import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function tableName(kind) {
    return kind === "gotm" ? "GOTM_NOMINATIONS" : "NR_GOTM_NOMINATIONS";
}
function mapRow(row) {
    const nominatedAt = row.NOMINATED_AT instanceof Date ? row.NOMINATED_AT : new Date(row.NOMINATED_AT);
    return {
        id: Number(row.NOMINATION_ID),
        roundNumber: Number(row.ROUND_NUMBER),
        userId: String(row.USER_ID),
        gameTitle: String(row.GAME_TITLE),
        nominatedAt,
        reason: row.REASON ?? null,
    };
}
export async function getNominationForUser(kind, roundNumber, userId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT NOMINATION_ID,
              ROUND_NUMBER,
              USER_ID,
              GAME_TITLE,
              NOMINATED_AT,
              REASON
         FROM ${tableName(kind)}
        WHERE ROUND_NUMBER = :roundNumber
          AND USER_ID = :userId`, { roundNumber, userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = (result.rows ?? [])[0];
        return row ? mapRow(row) : null;
    }
    finally {
        await connection.close();
    }
}
export async function upsertNomination(kind, roundNumber, userId, gameTitle, reason) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`MERGE INTO ${tableName(kind)} t
        USING (
          SELECT :roundNumber AS ROUND_NUMBER,
                 :userId AS USER_ID,
                 :gameTitle AS GAME_TITLE,
                 CAST(:nominatedAt AS TIMESTAMP) AS NOMINATED_AT,
                 :reason AS REASON
            FROM dual
        ) src
           ON (t.ROUND_NUMBER = src.ROUND_NUMBER AND t.USER_ID = src.USER_ID)
      WHEN MATCHED THEN
        UPDATE SET t.GAME_TITLE = src.GAME_TITLE,
                   t.NOMINATED_AT = src.NOMINATED_AT,
                   t.REASON = src.REASON
      WHEN NOT MATCHED THEN
        INSERT (ROUND_NUMBER, USER_ID, GAME_TITLE, NOMINATED_AT, REASON)
        VALUES (src.ROUND_NUMBER, src.USER_ID, src.GAME_TITLE, src.NOMINATED_AT, src.REASON)`, {
            roundNumber,
            userId,
            gameTitle,
            nominatedAt: new Date(),
            reason,
        }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
    const refreshed = await getNominationForUser(kind, roundNumber, userId);
    if (!refreshed) {
        throw new Error("Nomination upsert failed to return a row.");
    }
    return refreshed;
}
export async function deleteNominationForUser(kind, roundNumber, userId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`DELETE FROM ${tableName(kind)}
        WHERE ROUND_NUMBER = :roundNumber
          AND USER_ID = :userId`, { roundNumber, userId }, { autoCommit: true });
        const count = result.rowsAffected ?? 0;
        return count > 0;
    }
    finally {
        await connection.close();
    }
}
export async function listNominationsForRound(kind, roundNumber) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT NOMINATION_ID,
              ROUND_NUMBER,
              USER_ID,
              GAME_TITLE,
              NOMINATED_AT,
              REASON
         FROM ${tableName(kind)}
        WHERE ROUND_NUMBER = :roundNumber
        ORDER BY GAME_TITLE ASC`, { roundNumber }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows ?? []);
        return rows.map((row) => mapRow(row));
    }
    finally {
        await connection.close();
    }
}
