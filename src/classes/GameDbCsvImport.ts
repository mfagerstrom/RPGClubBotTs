import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type GameDbCsvImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type GameDbCsvItemStatus = "PENDING" | "SKIPPED" | "IMPORTED" | "ERROR";

export interface IGameDbCsvImport {
  importId: number;
  userId: string;
  status: GameDbCsvImportStatus;
  currentIndex: number;
  totalCount: number;
  sourceFilename: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGameDbCsvImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  gameTitle: string;
  rawGameTitle: string | null;
  platformName: string | null;
  regionName: string | null;
  initialReleaseDate: Date | null;
  status: GameDbCsvItemStatus;
  gameDbGameId: number | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: GameDbCsvImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILENAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IGameDbCsvImport {
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
  GAME_TITLE: string;
  RAW_GAME_TITLE: string | null;
  PLATFORM_NAME: string | null;
  REGION_NAME: string | null;
  INITIAL_RELEASE_DATE: Date | null;
  STATUS: GameDbCsvItemStatus;
  GAMEDB_GAME_ID: number | null;
  ERROR_TEXT: string | null;
}): IGameDbCsvImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    gameTitle: row.GAME_TITLE,
    rawGameTitle: row.RAW_GAME_TITLE ?? null,
    platformName: row.PLATFORM_NAME ?? null,
    regionName: row.REGION_NAME ?? null,
    initialReleaseDate: row.INITIAL_RELEASE_DATE
      ? row.INITIAL_RELEASE_DATE instanceof Date
        ? row.INITIAL_RELEASE_DATE
        : new Date(row.INITIAL_RELEASE_DATE as any)
      : null,
    status: row.STATUS,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    errorText: row.ERROR_TEXT ?? null,
  };
}

export async function createGameDbCsvImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFilename: string | null;
}): Promise<IGameDbCsvImport> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_GAMEDB_IMPORTS (
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
      throw new Error("Failed to create import session.");
    }

    const session = await getGameDbCsvImportById(id, connection);
    if (!session) {
      throw new Error("Failed to load import session.");
    }
    return session;
  } finally {
    await connection.close();
  }
}

export async function insertGameDbCsvImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    gameTitle: string;
    rawGameTitle: string | null;
    platformName: string | null;
    regionName: string | null;
    initialReleaseDate: Date | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  const connection = await getOraclePool().getConnection();
  try {
    for (const item of items) {
      await connection.execute(
        `INSERT INTO RPG_CLUB_GAMEDB_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           GAME_TITLE,
           RAW_GAME_TITLE,
           PLATFORM_NAME,
           REGION_NAME,
           INITIAL_RELEASE_DATE,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :rawGameTitle,
           :platformName,
           :regionName,
           :initialReleaseDate,
           'PENDING'
         )`,
        {
          importId,
          rowIndex: item.rowIndex,
          gameTitle: item.gameTitle,
          rawGameTitle: item.rawGameTitle,
          platformName: item.platformName,
          regionName: item.regionName,
          initialReleaseDate: item.initialReleaseDate,
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

export async function getGameDbCsvImportById(
  importId: number,
  existingConnection?: oracledb.Connection,
): Promise<IGameDbCsvImport | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const res = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: GameDbCsvImportStatus;
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
         FROM RPG_CLUB_GAMEDB_IMPORTS
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

export async function getActiveGameDbCsvImportForUser(
  userId: string,
): Promise<IGameDbCsvImport | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: GameDbCsvImportStatus;
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
         FROM RPG_CLUB_GAMEDB_IMPORTS
        WHERE USER_ID = :userId
          AND STATUS IN ('ACTIVE', 'PAUSED')
        ORDER BY CREATED_AT DESC, IMPORT_ID DESC
        FETCH FIRST 1 ROWS ONLY`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = res.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    await connection.close();
  }
}

export async function setGameDbCsvImportStatus(
  importId: number,
  status: GameDbCsvImportStatus,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GAMEDB_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`,
      { status, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateGameDbCsvImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GAMEDB_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`,
      { currentIndex, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getNextGameDbCsvImportItem(
  importId: number,
): Promise<IGameDbCsvImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      GAME_TITLE: string;
      RAW_GAME_TITLE: string | null;
      PLATFORM_NAME: string | null;
      REGION_NAME: string | null;
      INITIAL_RELEASE_DATE: Date | null;
      STATUS: GameDbCsvItemStatus;
      GAMEDB_GAME_ID: number | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
             ROW_INDEX,
             GAME_TITLE,
             RAW_GAME_TITLE,
             PLATFORM_NAME,
             REGION_NAME,
             INITIAL_RELEASE_DATE,
             STATUS,
             GAMEDB_GAME_ID,
              ERROR_TEXT
         FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX ASC
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

export async function getGameDbCsvImportItemById(
  itemId: number,
): Promise<IGameDbCsvImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      GAME_TITLE: string;
      RAW_GAME_TITLE: string | null;
      PLATFORM_NAME: string | null;
      REGION_NAME: string | null;
      INITIAL_RELEASE_DATE: Date | null;
      STATUS: GameDbCsvItemStatus;
      GAMEDB_GAME_ID: number | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
             ROW_INDEX,
             GAME_TITLE,
             RAW_GAME_TITLE,
             PLATFORM_NAME,
             REGION_NAME,
             INITIAL_RELEASE_DATE,
             STATUS,
             GAMEDB_GAME_ID,
              ERROR_TEXT
         FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
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

export async function updateGameDbCsvImportItem(
  itemId: number,
  updates: Partial<{
    status: GameDbCsvItemStatus;
    gameDbGameId: number | null;
    errorText: string | null;
  }>,
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, any> = { itemId };

  if (updates.status !== undefined) {
    fields.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!fields.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_GAMEDB_IMPORT_ITEMS
          SET ${fields.join(", ")}
        WHERE ITEM_ID = :itemId`,
      binds,
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function countGameDbCsvImportItems(importId: number): Promise<{
  pending: number;
  skipped: number;
  imported: number;
  error: number;
}> {
  const connection = await getOraclePool().getConnection();
  try {
    const res = await connection.execute<{ STATUS: string; CNT: number }>(
      `SELECT STATUS, COUNT(*) AS CNT
         FROM RPG_CLUB_GAMEDB_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY STATUS`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const stats = {
      pending: 0,
      skipped: 0,
      imported: 0,
      error: 0,
    };

    for (const row of res.rows ?? []) {
      const status = String(row.STATUS).toUpperCase();
      const count = Number(row.CNT ?? 0);
      if (status === "PENDING") stats.pending = count;
      if (status === "SKIPPED") stats.skipped = count;
      if (status === "IMPORTED") stats.imported = count;
      if (status === "ERROR") stats.error = count;
    }
    return stats;
  } finally {
    await connection.close();
  }
}
