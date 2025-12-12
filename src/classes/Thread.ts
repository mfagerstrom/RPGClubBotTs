import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

type NullableDate = Date | null;

function toYN(flag: boolean): string {
  return flag ? "Y" : "N";
}

export async function upsertThreadRecord(params: {
  threadId: string;
  forumChannelId: string;
  threadName: string;
  isArchived: boolean;
  createdAt: Date;
  lastSeenAt: NullableDate;
  skipLinking?: "Y" | "N";
}): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `
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
      `,
      {
        threadId: params.threadId,
        forumChannelId: params.forumChannelId,
        threadName: params.threadName,
        isArchived: toYN(params.isArchived),
        createdAt: params.createdAt,
        lastSeenAt: params.lastSeenAt,
        skipLinking: params.skipLinking ?? "N",
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function setThreadGameLink(threadId: string, gameId: number | null): Promise<void> {
  if (gameId !== null && (!Number.isInteger(gameId) || gameId <= 0)) {
    throw new Error("Invalid GameDB game id.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    if (gameId === null) {
      await connection.execute(
        `DELETE FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
        { threadId },
        { autoCommit: false },
      );
    } else {
      await connection.execute(
        `
        MERGE INTO THREAD_GAME_LINKS tgt
        USING (
          SELECT :threadId AS THREAD_ID, :gameId AS GAMEDB_GAME_ID FROM DUAL
        ) src
        ON (tgt.THREAD_ID = src.THREAD_ID AND tgt.GAMEDB_GAME_ID = src.GAMEDB_GAME_ID)
        WHEN NOT MATCHED THEN
          INSERT (THREAD_ID, GAMEDB_GAME_ID, LINKED_AT)
          VALUES (src.THREAD_ID, src.GAMEDB_GAME_ID, SYSTIMESTAMP)
        `,
        { threadId, gameId },
        { autoCommit: false },
      );
    }

    await connection.execute(
      `
      UPDATE THREADS t
      SET GAMEDB_GAME_ID = (
        SELECT MIN(g.GAMEDB_GAME_ID) FROM THREAD_GAME_LINKS g WHERE g.THREAD_ID = t.THREAD_ID
      )
      WHERE t.THREAD_ID = :threadId
      `,
      { threadId },
      { autoCommit: false },
    );

    await connection.commit();
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    await connection.close();
  }
}

export async function removeThreadGameLink(threadId: string, gameId?: number): Promise<number> {
  if (gameId !== undefined && (gameId === null || !Number.isInteger(gameId) || gameId <= 0)) {
    throw new Error("Invalid GameDB game id.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const res = await connection.execute(
      `
      DELETE FROM THREAD_GAME_LINKS
      WHERE THREAD_ID = :threadId
      ${gameId ? "AND GAMEDB_GAME_ID = :gameId" : ""}
      `,
      gameId ? { threadId, gameId } : { threadId },
      { autoCommit: false },
    );

    await connection.execute(
      `
      UPDATE THREADS t
      SET GAMEDB_GAME_ID = (
        SELECT MIN(g.GAMEDB_GAME_ID) FROM THREAD_GAME_LINKS g WHERE g.THREAD_ID = t.THREAD_ID
      )
      WHERE t.THREAD_ID = :threadId
      `,
      { threadId },
      { autoCommit: false },
    );

    await connection.commit();
    return (res as any).rowsAffected ?? 0;
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    await connection.close();
  }
}

export async function setThreadSkipLinking(threadId: string, skip: boolean): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `
      UPDATE THREADS
      SET SKIP_LINKING = :skip
      WHERE THREAD_ID = :threadId
      `,
      { skip: toYN(skip), threadId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getThreadSkipLinking(threadId: string): Promise<boolean> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const res = await connection.execute<{ SKIP_LINKING: string }>(
      `SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`,
      { threadId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = (res.rows ?? [])[0] as any;
    const flag = row?.SKIP_LINKING ?? "N";
    return String(flag).toUpperCase() === "Y";
  } finally {
    await connection.close();
  }
}

export async function getThreadLinkInfo(
  threadId: string,
): Promise<{ skipLinking: boolean; gamedbGameIds: number[] }> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const infoRes = await connection.execute<{ SKIP_LINKING: string }>(
      `SELECT SKIP_LINKING FROM THREADS WHERE THREAD_ID = :threadId`,
      { threadId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = (infoRes.rows ?? [])[0] as any;
    const skipFlag = String(row?.SKIP_LINKING ?? "N").toUpperCase() === "Y";

    const linksRes = await connection.execute<{ GAMEDB_GAME_ID: number }>(
      `SELECT GAMEDB_GAME_ID FROM THREAD_GAME_LINKS WHERE THREAD_ID = :threadId`,
      { threadId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const gameIds = (linksRes.rows ?? []).map((r) => Number(r.GAMEDB_GAME_ID));

    if (!gameIds.length) {
      const legacyRes = await connection.execute<{ GAMEDB_GAME_ID: number | null }>(
        `SELECT GAMEDB_GAME_ID FROM THREADS WHERE THREAD_ID = :threadId`,
        { threadId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const legacyRow = (legacyRes.rows ?? [])[0] as any;
      if (legacyRow?.GAMEDB_GAME_ID != null) {
        gameIds.push(Number(legacyRow.GAMEDB_GAME_ID));
      }
    }

    const uniqueIds = Array.from(new Set(gameIds));
    return { skipLinking: skipFlag, gamedbGameIds: uniqueIds };
  } finally {
    await connection.close();
  }
}

export async function getThreadGameIds(threadId: string): Promise<number[]> {
  const info = await getThreadLinkInfo(threadId);
  return info.gamedbGameIds;
}

export async function getThreadsByGameId(gameId: number): Promise<string[]> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const linksRes = await connection.execute<{ THREAD_ID: string }>(
      `SELECT THREAD_ID FROM THREAD_GAME_LINKS WHERE GAMEDB_GAME_ID = :gameId`,
      { gameId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const threadIds = (linksRes.rows ?? []).map((r) => String(r.THREAD_ID));

    // Also check legacy column in THREADS table
    const legacyRes = await connection.execute<{ THREAD_ID: string }>(
      `SELECT THREAD_ID FROM THREADS WHERE GAMEDB_GAME_ID = :gameId`,
      { gameId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const legacyIds = (legacyRes.rows ?? []).map((r) => String(r.THREAD_ID));

    return Array.from(new Set([...threadIds, ...legacyIds]));
  } finally {
    await connection.close();
  }
}
