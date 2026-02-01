import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type GotmAuditStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type GotmAuditItemStatus = "PENDING" | "SKIPPED" | "IMPORTED" | "ERROR";
export type GotmAuditKind = "gotm" | "nr-gotm";

export interface IGotmAuditImport {
  importId: number;
  userId: string;
  status: GotmAuditStatus;
  currentIndex: number;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGotmAuditItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  kind: GotmAuditKind;
  roundNumber: number;
  monthYear: string;
  gameIndex: number;
  gameTitle: string;
  threadId: string | null;
  redditUrl: string | null;
  status: GotmAuditItemStatus;
  gameDbGameId: number | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: GotmAuditStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILENAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGotmAuditImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    sourceFilename: row.SOURCE_FILENAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

function mapItem(row: {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  KIND: string;
  ROUND_NUMBER: number;
  MONTH_YEAR: string;
  GAME_INDEX: number;
  GAME_TITLE: string;
  THREAD_ID: string | null;
  REDDIT_URL: string | null;
  STATUS: GotmAuditItemStatus;
  GAMEDB_GAME_ID: number | null;
  ERROR_TEXT: string | null;
}): IGotmAuditItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    kind: row.KIND === "nr-gotm" ? "nr-gotm" : "gotm",
    roundNumber: Number(row.ROUND_NUMBER),
    monthYear: row.MONTH_YEAR,
    gameIndex: Number(row.GAME_INDEX),
    gameTitle: row.GAME_TITLE,
    threadId: row.THREAD_ID ?? null,
    redditUrl: row.REDDIT_URL ?? null,
    status: row.STATUS,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    errorText: row.ERROR_TEXT ?? null,
  };
}

export async function createGotmAuditImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFilename: string | null;
}): Promise<IGotmAuditImport> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_GOTM_AUDIT_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`,
      {
        userId: params.userId,
        totalCount: params.totalCount,
        sourceFilename: params.sourceFilename,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );
    const id = Number((result.outBinds as any)?.id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create GOTM audit session.");
    }

    const session = await getGotmAuditImportById(id, connection);
    if (!session) {
      throw new Error("Failed to load GOTM audit session.");
    }
    return session;
  } finally {
    await connection.close();
  }
}

export async function insertGotmAuditImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    kind: GotmAuditKind;
    roundNumber: number;
    monthYear: string;
    gameIndex: number;
    gameTitle: string;
    threadId: string | null;
    redditUrl: string | null;
    gameDbGameId: number | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  const connection = await getOraclePool().getConnection();
  try {
    for (const item of items) {
      await connection.execute(
        `INSERT INTO RPG_CLUB_GOTM_AUDIT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           KIND,
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           GAME_TITLE,
           THREAD_ID,
           REDDIT_URL,
           STATUS,
           GAMEDB_GAME_ID
         ) VALUES (
           :importId,
           :rowIndex,
           :kind,
           :roundNumber,
           :monthYear,
           :gameIndex,
           :gameTitle,
           :threadId,
           :redditUrl,
           'PENDING',
           :gameDbGameId
         )`,
        {
          importId,
          rowIndex: item.rowIndex,
          kind: item.kind,
          roundNumber: item.roundNumber,
          monthYear: item.monthYear,
          gameIndex: item.gameIndex,
          gameTitle: item.gameTitle,
          threadId: item.threadId,
          redditUrl: item.redditUrl,
          gameDbGameId: item.gameDbGameId,
        },
        { autoCommit: false },
      );
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    await connection.close();
  }
}

export async function getGotmAuditImportById(
  importId: number,
  existingConnection?: oracledb.Connection,
): Promise<IGotmAuditImport | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const res = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: GotmAuditStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      SOURCE_FILENAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              SOURCE_FILENAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_GOTM_AUDIT_IMPORTS
        WHERE IMPORT_ID = :id`,
      { id: importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function getActiveGotmAuditImportForUser(
  userId: string,
): Promise<IGotmAuditImport | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: GotmAuditStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      SOURCE_FILENAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              SOURCE_FILENAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_GOTM_AUDIT_IMPORTS
        WHERE USER_ID = :userId
          AND STATUS IN ('ACTIVE', 'PAUSED')
        ORDER BY IMPORT_ID DESC`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    await connection.close();
  }
}

export async function setGotmAuditImportStatus(
  importId: number,
  status: GotmAuditStatus,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`,
      { importId, status },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateGotmAuditImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GOTM_AUDIT_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`,
      { importId, currentIndex },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getNextGotmAuditItem(
  importId: number,
): Promise<IGotmAuditItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      KIND: string;
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      GAME_TITLE: string;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      STATUS: GotmAuditItemStatus;
      GAMEDB_GAME_ID: number | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              KIND,
              ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              STATUS,
              GAMEDB_GAME_ID,
              ERROR_TEXT
         FROM RPG_CLUB_GOTM_AUDIT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX
        FETCH FIRST 1 ROWS ONLY`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function getGotmAuditItemById(
  itemId: number,
): Promise<IGotmAuditItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      KIND: string;
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      GAME_TITLE: string;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      STATUS: GotmAuditItemStatus;
      GAMEDB_GAME_ID: number | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              KIND,
              ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              STATUS,
              GAMEDB_GAME_ID,
              ERROR_TEXT
         FROM RPG_CLUB_GOTM_AUDIT_ITEMS
        WHERE ITEM_ID = :itemId`,
      { itemId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function updateGotmAuditItem(
  itemId: number,
  changes: Partial<{
    status: GotmAuditItemStatus;
    gameDbGameId: number | null;
    errorText: string | null;
  }>,
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, any> = { itemId };

  if (changes.status) {
    fields.push("STATUS = :status");
    binds.status = changes.status;
  }

  if (changes.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = changes.gameDbGameId;
  }

  if (changes.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = changes.errorText;
  }

  if (!fields.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GOTM_AUDIT_ITEMS
          SET ${fields.join(", ")}
        WHERE ITEM_ID = :itemId`,
      binds,
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getGotmAuditItemsForRound(
  importId: number,
  kind: GotmAuditKind,
  roundNumber: number,
): Promise<IGotmAuditItem[]> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      KIND: string;
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      GAME_TITLE: string;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      STATUS: GotmAuditItemStatus;
      GAMEDB_GAME_ID: number | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              KIND,
              ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              STATUS,
              GAMEDB_GAME_ID,
              ERROR_TEXT
         FROM RPG_CLUB_GOTM_AUDIT_ITEMS
        WHERE IMPORT_ID = :importId
          AND KIND = :kind
          AND ROUND_NUMBER = :roundNumber
        ORDER BY GAME_INDEX`,
      { importId, kind, roundNumber },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (res.rows ?? []).map((row) => mapItem(row));
  } finally {
    await connection.close();
  }
}

export async function countGotmAuditItems(importId: number): Promise<{
  pending: number;
  imported: number;
  skipped: number;
  error: number;
}> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      STATUS: GotmAuditItemStatus;
      CNT: number;
    }>(
      `SELECT STATUS, COUNT(*) AS CNT
         FROM RPG_CLUB_GOTM_AUDIT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY STATUS`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const stats = {
      pending: 0,
      imported: 0,
      skipped: 0,
      error: 0,
    };
    for (const row of res.rows ?? []) {
      const status = row.STATUS;
      const count = Number(row.CNT ?? 0);
      if (status === "PENDING") stats.pending = count;
      else if (status === "IMPORTED") stats.imported = count;
      else if (status === "SKIPPED") stats.skipped = count;
      else if (status === "ERROR") stats.error = count;
    }
    return stats;
  } finally {
    await connection.close();
  }
}
