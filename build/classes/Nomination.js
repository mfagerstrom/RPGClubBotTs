import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function tableName(kind) {
    return kind === "gotm" ? "GOTM_NOMINATIONS" : "NR_GOTM_NOMINATIONS";
}
function mapRow(row) {
    const nominatedAt = row.NOMINATED_AT instanceof Date ? row.NOMINATED_AT : new Date(row.NOMINATED_AT);
    if (row.GAMEDB_GAME_ID === null || row.GAMEDB_GAME_ID === undefined) {
        throw new Error("Nomination row is missing a GameDB game id.");
    }
    const gamedbGameId = Number(row.GAMEDB_GAME_ID);
    const gameTitle = row.GAMEDB_TITLE !== undefined && row.GAMEDB_TITLE !== null
        ? String(row.GAMEDB_TITLE)
        : `(missing GameDB title for id ${gamedbGameId})`;
    return {
        id: Number(row.NOMINATION_ID),
        roundNumber: Number(row.ROUND_NUMBER),
        userId: String(row.USER_ID),
        gameTitle,
        gamedbGameId,
        nominatedAt,
        reason: row.REASON ?? null,
    };
}
export async function getNominationForUser(kind, roundNumber, userId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT n.NOMINATION_ID,
              n.ROUND_NUMBER,
              n.USER_ID,
              n.GAMEDB_GAME_ID,
              g.TITLE AS GAMEDB_TITLE,
              n.NOMINATED_AT,
              n.REASON
         FROM ${tableName(kind)} n
         LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
        WHERE n.ROUND_NUMBER = :roundNumber
          AND n.USER_ID = :userId`, { roundNumber, userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = (result.rows ?? [])[0];
        return row ? mapRow(row) : null;
    }
    finally {
        await connection.close();
    }
}
export async function upsertNomination(kind, roundNumber, userId, gamedbGameId, reason) {
    if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
        throw new Error("A valid GameDB game id is required to save a nomination.");
    }
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`MERGE INTO ${tableName(kind)} t
        USING (
          SELECT :roundNumber AS ROUND_NUMBER,
                 :userId AS USER_ID,
                 :gamedbGameId AS GAMEDB_GAME_ID,
                 CAST(:nominatedAt AS TIMESTAMP) AS NOMINATED_AT,
                 :reason AS REASON
            FROM dual
        ) src
           ON (t.ROUND_NUMBER = src.ROUND_NUMBER AND t.USER_ID = src.USER_ID)
      WHEN MATCHED THEN
        UPDATE SET t.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID,
                   t.NOMINATED_AT = src.NOMINATED_AT,
                   t.REASON = src.REASON
      WHEN NOT MATCHED THEN
        INSERT (ROUND_NUMBER, USER_ID, GAMEDB_GAME_ID, NOMINATED_AT, REASON)
        VALUES (src.ROUND_NUMBER, src.USER_ID, src.GAMEDB_GAME_ID, src.NOMINATED_AT, src.REASON)`, {
            roundNumber,
            userId,
            gamedbGameId,
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
        const result = await connection.execute(`SELECT n.NOMINATION_ID,
              n.ROUND_NUMBER,
              n.USER_ID,
              n.GAMEDB_GAME_ID,
              g.TITLE AS GAMEDB_TITLE,
              n.NOMINATED_AT,
              n.REASON
         FROM ${tableName(kind)} n
         LEFT JOIN GAMEDB_GAMES g ON g.GAME_ID = n.GAMEDB_GAME_ID
        WHERE n.ROUND_NUMBER = :roundNumber
        ORDER BY g.TITLE ASC`, { roundNumber }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows ?? []);
        return rows.map((row) => mapRow(row));
    }
    finally {
        await connection.close();
    }
}
