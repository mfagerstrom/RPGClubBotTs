import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function toYN(flag) {
    return flag ? "Y" : "N";
}
export async function upsertThreadRecord(params) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`
      MERGE INTO THREADS t
      USING (
        SELECT
          :threadId       AS THREAD_ID,
          :forumChannelId AS FORUM_CHANNEL_ID,
          :threadName     AS THREAD_NAME,
          :isArchived     AS IS_ARCHIVED,
          :createdAt      AS CREATED_AT,
          :lastSeenAt     AS LAST_SEEN_AT,
          :skipLinking    AS SKIP_LINKING
        FROM DUAL
      ) s
      ON (t.THREAD_ID = s.THREAD_ID)
      WHEN MATCHED THEN UPDATE SET
        t.THREAD_NAME      = s.THREAD_NAME,
        t.FORUM_CHANNEL_ID = s.FORUM_CHANNEL_ID,
        t.IS_ARCHIVED      = s.IS_ARCHIVED,
        t.LAST_SEEN_AT     = s.LAST_SEEN_AT
      WHEN NOT MATCHED THEN INSERT (
        THREAD_ID, FORUM_CHANNEL_ID, THREAD_NAME, IS_ARCHIVED, CREATED_AT, LAST_SEEN_AT, SKIP_LINKING
      ) VALUES (
        s.THREAD_ID, s.FORUM_CHANNEL_ID, s.THREAD_NAME, s.IS_ARCHIVED, s.CREATED_AT, s.LAST_SEEN_AT, s.SKIP_LINKING
      )
      `, {
            threadId: params.threadId,
            forumChannelId: params.forumChannelId,
            threadName: params.threadName,
            isArchived: toYN(params.isArchived),
            createdAt: params.createdAt,
            lastSeenAt: params.lastSeenAt,
            skipLinking: params.skipLinking ?? "N",
        }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function setThreadGameLink(threadId, gameId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`
      UPDATE THREADS
      SET GAMEDB_GAME_ID = :gameId
      WHERE THREAD_ID = :threadId
      `, { gameId, threadId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function setThreadSkipLinking(threadId, skip) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`
      UPDATE THREADS
      SET SKIP_LINKING = :skip
      WHERE THREAD_ID = :threadId
      `, { skip: toYN(skip), threadId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function getThreadSkipLinking(threadId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const res = await connection.execute(`SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`, { threadId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = (res.rows ?? [])[0];
        const flag = row?.SKIP_LINKING ?? "N";
        return String(flag).toUpperCase() === "Y";
    }
    finally {
        await connection.close();
    }
}
export async function getThreadLinkInfo(threadId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const res = await connection.execute(`SELECT SKIP_LINKING, GAMEDB_GAME_ID FROM THREADS WHERE THREAD_ID = :threadId`, { threadId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = (res.rows ?? [])[0];
        const skipFlag = String(row?.SKIP_LINKING ?? "N").toUpperCase() === "Y";
        const gameId = row && row.GAMEDB_GAME_ID != null ? Number(row.GAMEDB_GAME_ID) : null;
        return { skipLinking: skipFlag, gamedbGameId: gameId };
    }
    finally {
        await connection.close();
    }
}
