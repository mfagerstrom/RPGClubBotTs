import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type XboxCollectionImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type XboxCollectionImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type XboxCollectionMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type XboxTitleGameDbMapStatus = "MAPPED" | "SKIPPED";
export type XboxCollectionImportResultReason =
  | "AUTO_MATCH"
  | "XBOX_GAMEDB_ID"
  | "XBOX_IGDB_ID"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "SKIP_MAPPED"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED"
  | "INVALID_ROW";

export interface IXboxCollectionImport {
  importId: number;
  userId: string;
  status: XboxCollectionImportStatus;
  currentIndex: number;
  totalCount: number;
  xuid: string | null;
  gamertag: string | null;
  sourceType: "API" | "CSV";
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IXboxCollectionImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  xboxTitleId: string | null;
  xboxProductId: string | null;
  xboxTitleName: string;
  rawPlatform: string | null;
  rawOwnershipType: string | null;
  rawNote: string | null;
  rawGameDbId: number | null;
  rawIgdbId: number | null;
  platformId: number | null;
  ownershipType: string | null;
  note: string | null;
  status: XboxCollectionImportItemStatus;
  matchConfidence: XboxCollectionMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: XboxCollectionImportResultReason | null;
  errorText: string | null;
}

export interface IXboxTitleGameDbMap {
  mapId: number;
  xboxTitleId: string;
  gameDbGameId: number | null;
  status: XboxTitleGameDbMapStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: XboxCollectionImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  XUID: string | null;
  GAMERTAG: string | null;
  SOURCE_TYPE: "API" | "CSV";
  SOURCE_FILE_NAME: string | null;
  SOURCE_FILE_SIZE: number | null;
  TEMPLATE_VERSION: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IXboxCollectionImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    xuid: row.XUID ?? null,
    gamertag: row.GAMERTAG ?? null,
    sourceType: row.SOURCE_TYPE,
    sourceFileName: row.SOURCE_FILE_NAME ?? null,
    sourceFileSize: row.SOURCE_FILE_SIZE == null ? null : Number(row.SOURCE_FILE_SIZE),
    templateVersion: row.TEMPLATE_VERSION ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

function mapItem(row: {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  XBOX_TITLE_ID: string | null;
  XBOX_PRODUCT_ID: string | null;
  XBOX_TITLE_NAME: string;
  RAW_PLATFORM: string | null;
  RAW_OWNERSHIP_TYPE: string | null;
  RAW_NOTE: string | null;
  RAW_GAMEDB_ID: number | null;
  RAW_IGDB_ID: number | null;
  PLATFORM_ID: number | null;
  OWNERSHIP_TYPE: string | null;
  NOTE: string | null;
  STATUS: XboxCollectionImportItemStatus;
  MATCH_CONFIDENCE: XboxCollectionMatchConfidence | null;
  MATCH_CANDIDATE_JSON: string | null;
  GAMEDB_GAME_ID: number | null;
  COLLECTION_ENTRY_ID: number | null;
  RESULT_REASON: XboxCollectionImportResultReason | null;
  ERROR_TEXT: string | null;
}): IXboxCollectionImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    xboxTitleId: row.XBOX_TITLE_ID ?? null,
    xboxProductId: row.XBOX_PRODUCT_ID ?? null,
    xboxTitleName: row.XBOX_TITLE_NAME,
    rawPlatform: row.RAW_PLATFORM ?? null,
    rawOwnershipType: row.RAW_OWNERSHIP_TYPE ?? null,
    rawNote: row.RAW_NOTE ?? null,
    rawGameDbId: row.RAW_GAMEDB_ID == null ? null : Number(row.RAW_GAMEDB_ID),
    rawIgdbId: row.RAW_IGDB_ID == null ? null : Number(row.RAW_IGDB_ID),
    platformId: row.PLATFORM_ID == null ? null : Number(row.PLATFORM_ID),
    ownershipType: row.OWNERSHIP_TYPE ?? null,
    note: row.NOTE ?? null,
    status: row.STATUS,
    matchConfidence: row.MATCH_CONFIDENCE ?? null,
    matchCandidateJson: row.MATCH_CANDIDATE_JSON ?? null,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    collectionEntryId: row.COLLECTION_ENTRY_ID == null ? null : Number(row.COLLECTION_ENTRY_ID),
    resultReason: row.RESULT_REASON ?? null,
    errorText: row.ERROR_TEXT ?? null,
  };
}

function mapTitleMap(row: {
  MAP_ID: number;
  XBOX_TITLE_ID: string;
  GAMEDB_GAME_ID: number | null;
  STATUS: XboxTitleGameDbMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): IXboxTitleGameDbMap {
  return {
    mapId: Number(row.MAP_ID),
    xboxTitleId: row.XBOX_TITLE_ID,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createXboxCollectionImportSession(params: {
  userId: string;
  totalCount: number;
  xuid: string | null;
  gamertag: string | null;
  sourceType: "API" | "CSV";
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
}): Promise<IXboxCollectionImport> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_XBOX_COLLECTION_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         XUID,
         GAMERTAG,
         SOURCE_TYPE,
         SOURCE_FILE_NAME,
         SOURCE_FILE_SIZE,
         TEMPLATE_VERSION
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :xuid,
         :gamertag,
         :sourceType,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING IMPORT_ID INTO :id`,
      {
        userId: params.userId,
        totalCount: params.totalCount,
        xuid: params.xuid,
        gamertag: params.gamertag,
        sourceType: params.sourceType,
        sourceFileName: params.sourceFileName,
        sourceFileSize: params.sourceFileSize,
        templateVersion: params.templateVersion,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );

    const id = Number((result.outBinds as { id?: number[] }).id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create Xbox collection import session.");
    }

    const session = await getXboxCollectionImportById(id, connection);
    if (!session) {
      throw new Error("Failed to load Xbox collection import session.");
    }

    return session;
  } finally {
    await connection.close();
  }
}

export async function insertXboxCollectionImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    xboxTitleId: string | null;
    xboxProductId: string | null;
    xboxTitleName: string;
    rawPlatform: string | null;
    rawOwnershipType: string | null;
    rawNote: string | null;
    rawGameDbId: number | null;
    rawIgdbId: number | null;
    platformId: number | null;
    ownershipType: string | null;
    note: string | null;
  }>,
): Promise<void> {
  if (!items.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    for (const item of items) {
      await connection.execute(
        `INSERT INTO RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           XBOX_TITLE_ID,
           XBOX_PRODUCT_ID,
           XBOX_TITLE_NAME,
           RAW_PLATFORM,
           RAW_OWNERSHIP_TYPE,
           RAW_NOTE,
           RAW_GAMEDB_ID,
           RAW_IGDB_ID,
           PLATFORM_ID,
           OWNERSHIP_TYPE,
           NOTE,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :xboxTitleId,
           :xboxProductId,
           :xboxTitleName,
           :rawPlatform,
           :rawOwnershipType,
           :rawNote,
           :rawGameDbId,
           :rawIgdbId,
           :platformId,
           :ownershipType,
           :note,
           'PENDING'
         )`,
        {
          importId,
          rowIndex: item.rowIndex,
          xboxTitleId: item.xboxTitleId,
          xboxProductId: item.xboxProductId,
          xboxTitleName: item.xboxTitleName,
          rawPlatform: item.rawPlatform,
          rawOwnershipType: item.rawOwnershipType,
          rawNote: item.rawNote,
          rawGameDbId: item.rawGameDbId,
          rawIgdbId: item.rawIgdbId,
          platformId: item.platformId,
          ownershipType: item.ownershipType,
          note: item.note,
        },
        { autoCommit: true },
      );
    }
  } finally {
    await connection.close();
  }
}

export async function getXboxCollectionImportById(
  importId: number,
  connectionOverride?: oracledb.Connection,
): Promise<IXboxCollectionImport | null> {
  const connection = connectionOverride ?? await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: XboxCollectionImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      XUID: string | null;
      GAMERTAG: string | null;
      SOURCE_TYPE: "API" | "CSV";
      SOURCE_FILE_NAME: string | null;
      SOURCE_FILE_SIZE: number | null;
      TEMPLATE_VERSION: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              XUID,
              GAMERTAG,
              SOURCE_TYPE,
              SOURCE_FILE_NAME,
              SOURCE_FILE_SIZE,
              TEMPLATE_VERSION,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS
        WHERE IMPORT_ID = :importId`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    if (!connectionOverride) {
      await connection.close();
    }
  }
}

export async function getActiveXboxCollectionImportForUser(
  userId: string,
): Promise<IXboxCollectionImport | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: XboxCollectionImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      XUID: string | null;
      GAMERTAG: string | null;
      SOURCE_TYPE: "API" | "CSV";
      SOURCE_FILE_NAME: string | null;
      SOURCE_FILE_SIZE: number | null;
      TEMPLATE_VERSION: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              XUID,
              GAMERTAG,
              SOURCE_TYPE,
              SOURCE_FILE_NAME,
              SOURCE_FILE_SIZE,
              TEMPLATE_VERSION,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORTS
        WHERE USER_ID = :userId
          AND STATUS IN ('ACTIVE', 'PAUSED')
        ORDER BY IMPORT_ID DESC`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    await connection.close();
  }
}

export async function setXboxCollectionImportStatus(
  importId: number,
  status: XboxCollectionImportStatus,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`,
      { importId, status },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateXboxCollectionImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`,
      { importId, currentIndex },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getXboxCollectionImportItemById(
  itemId: number,
): Promise<IXboxCollectionImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      XBOX_TITLE_ID: string | null;
      XBOX_PRODUCT_ID: string | null;
      XBOX_TITLE_NAME: string;
      RAW_PLATFORM: string | null;
      RAW_OWNERSHIP_TYPE: string | null;
      RAW_NOTE: string | null;
      RAW_GAMEDB_ID: number | null;
      RAW_IGDB_ID: number | null;
      PLATFORM_ID: number | null;
      OWNERSHIP_TYPE: string | null;
      NOTE: string | null;
      STATUS: XboxCollectionImportItemStatus;
      MATCH_CONFIDENCE: XboxCollectionMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: XboxCollectionImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              XBOX_TITLE_ID,
              XBOX_PRODUCT_ID,
              XBOX_TITLE_NAME,
              RAW_PLATFORM,
              RAW_OWNERSHIP_TYPE,
              RAW_NOTE,
              RAW_GAMEDB_ID,
              RAW_IGDB_ID,
              PLATFORM_ID,
              OWNERSHIP_TYPE,
              NOTE,
              STATUS,
              MATCH_CONFIDENCE,
              MATCH_CANDIDATE_JSON,
              GAMEDB_GAME_ID,
              COLLECTION_ENTRY_ID,
              RESULT_REASON,
              ERROR_TEXT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        WHERE ITEM_ID = :itemId`,
      { itemId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function getNextPendingXboxCollectionImportItem(
  importId: number,
): Promise<IXboxCollectionImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      XBOX_TITLE_ID: string | null;
      XBOX_PRODUCT_ID: string | null;
      XBOX_TITLE_NAME: string;
      RAW_PLATFORM: string | null;
      RAW_OWNERSHIP_TYPE: string | null;
      RAW_NOTE: string | null;
      RAW_GAMEDB_ID: number | null;
      RAW_IGDB_ID: number | null;
      PLATFORM_ID: number | null;
      OWNERSHIP_TYPE: string | null;
      NOTE: string | null;
      STATUS: XboxCollectionImportItemStatus;
      MATCH_CONFIDENCE: XboxCollectionMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: XboxCollectionImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              XBOX_TITLE_ID,
              XBOX_PRODUCT_ID,
              XBOX_TITLE_NAME,
              RAW_PLATFORM,
              RAW_OWNERSHIP_TYPE,
              RAW_NOTE,
              RAW_GAMEDB_ID,
              RAW_IGDB_ID,
              PLATFORM_ID,
              OWNERSHIP_TYPE,
              NOTE,
              STATUS,
              MATCH_CONFIDENCE,
              MATCH_CANDIDATE_JSON,
              GAMEDB_GAME_ID,
              COLLECTION_ENTRY_ID,
              RESULT_REASON,
              ERROR_TEXT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX ASC
        FETCH FIRST 1 ROWS ONLY`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function updateXboxCollectionImportItem(
  itemId: number,
  updates: {
    status?: XboxCollectionImportItemStatus;
    matchConfidence?: XboxCollectionMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: XboxCollectionImportResultReason | null;
    errorText?: string | null;
  },
): Promise<void> {
  const fields: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (updates.status) {
    fields.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.matchConfidence !== undefined) {
    fields.push("MATCH_CONFIDENCE = :matchConfidence");
    binds.matchConfidence = updates.matchConfidence;
  }
  if (updates.matchCandidateJson !== undefined) {
    fields.push("MATCH_CANDIDATE_JSON = :matchCandidateJson");
    binds.matchCandidateJson = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) {
    fields.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.collectionEntryId !== undefined) {
    fields.push("COLLECTION_ENTRY_ID = :collectionEntryId");
    binds.collectionEntryId = updates.collectionEntryId;
  }
  if (updates.resultReason !== undefined) {
    fields.push("RESULT_REASON = :resultReason");
    binds.resultReason = updates.resultReason;
  }
  if (updates.errorText !== undefined) {
    fields.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!fields.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
          SET ${fields.join(", ")}
        WHERE ITEM_ID = :itemId`,
      binds,
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function countXboxCollectionImportItems(
  importId: number,
): Promise<{
  pending: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      STATUS: XboxCollectionImportItemStatus;
      CNT: number;
    }>(
      `SELECT STATUS, COUNT(*) AS CNT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY STATUS`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const counts = {
      pending: 0,
      added: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    for (const row of result.rows ?? []) {
      const status = row.STATUS;
      const count = Number(row.CNT ?? 0);
      if (status === "PENDING") counts.pending = count;
      if (status === "ADDED") counts.added = count;
      if (status === "UPDATED") counts.updated = count;
      if (status === "SKIPPED") counts.skipped = count;
      if (status === "FAILED") counts.failed = count;
    }
    return counts;
  } finally {
    await connection.close();
  }
}

export async function countXboxCollectionImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      RESULT_REASON: XboxCollectionImportResultReason | null;
      CNT: number;
    }>(
      `SELECT RESULT_REASON, COUNT(*) AS CNT
         FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY RESULT_REASON`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows ?? []) {
      if (!row.RESULT_REASON) continue;
      counts[row.RESULT_REASON] = Number(row.CNT ?? 0);
    }
    return counts;
  } finally {
    await connection.close();
  }
}

export async function getXboxTitleGameDbMapByTitleId(
  xboxTitleId: string,
): Promise<IXboxTitleGameDbMap | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      MAP_ID: number;
      XBOX_TITLE_ID: string;
      GAMEDB_GAME_ID: number | null;
      STATUS: XboxTitleGameDbMapStatus;
      CREATED_BY: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT MAP_ID,
              XBOX_TITLE_ID,
              GAMEDB_GAME_ID,
              STATUS,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_XBOX_TITLE_GAMEDB_MAP
        WHERE XBOX_TITLE_ID = :xboxTitleId`,
      { xboxTitleId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapTitleMap(row) : null;
  } finally {
    await connection.close();
  }
}

export async function upsertXboxTitleGameDbMap(params: {
  xboxTitleId: string;
  gameDbGameId: number | null;
  status: XboxTitleGameDbMapStatus;
  createdBy: string | null;
}): Promise<IXboxTitleGameDbMap> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `MERGE INTO RPG_CLUB_XBOX_TITLE_GAMEDB_MAP m
       USING (
         SELECT :xboxTitleId AS xboxTitleId,
                :gameDbGameId AS gameDbGameId,
                :status AS status,
                :createdBy AS createdBy
           FROM dual
       ) src
          ON (m.XBOX_TITLE_ID = src.xboxTitleId)
       WHEN MATCHED THEN UPDATE SET
         m.GAMEDB_GAME_ID = src.gameDbGameId,
         m.STATUS = src.status,
         m.CREATED_BY = src.createdBy
       WHEN NOT MATCHED THEN INSERT (
         XBOX_TITLE_ID,
         GAMEDB_GAME_ID,
         STATUS,
         CREATED_BY
       ) VALUES (
         src.xboxTitleId,
         src.gameDbGameId,
         src.status,
         src.createdBy
       )`,
      {
        xboxTitleId: params.xboxTitleId,
        gameDbGameId: params.gameDbGameId,
        status: params.status,
        createdBy: params.createdBy,
      },
      { autoCommit: true },
    );

    const mapping = await getXboxTitleGameDbMapByTitleId(params.xboxTitleId);
    if (!mapping) {
      throw new Error("Failed to load Xbox title mapping.");
    }
    return mapping;
  } finally {
    await connection.close();
  }
}

export async function getXboxTitleHistoricalMappedGameIds(params: {
  xboxTitleId: string;
  excludeUserId?: string;
  limit?: number;
}): Promise<number[]> {
  const limit = Number.isInteger(params.limit) && (params.limit ?? 0) > 0 ? Number(params.limit) : 5;
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      GAMEDB_GAME_ID: number;
    }>(
      `SELECT t.GAMEDB_GAME_ID
         FROM (
           SELECT ii.GAMEDB_GAME_ID,
                  COUNT(*) AS CNT,
                  MAX(ii.ITEM_ID) AS LAST_ITEM_ID
             FROM RPG_CLUB_XBOX_COLLECTION_IMPORT_ITEMS ii
             JOIN RPG_CLUB_XBOX_COLLECTION_IMPORTS i
               ON i.IMPORT_ID = ii.IMPORT_ID
            WHERE ii.XBOX_TITLE_ID = :xboxTitleId
              AND ii.GAMEDB_GAME_ID IS NOT NULL
              AND ii.RESULT_REASON = 'MANUAL_REMAP'
              AND (:excludeUserId IS NULL OR i.USER_ID <> :excludeUserId)
            GROUP BY ii.GAMEDB_GAME_ID
            ORDER BY CNT DESC, LAST_ITEM_ID DESC
         ) t
        WHERE ROWNUM <= :limit`,
      {
        xboxTitleId: params.xboxTitleId,
        excludeUserId: params.excludeUserId ?? null,
        limit,
      },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    return (result.rows ?? [])
      .map((row) => Number(row.GAMEDB_GAME_ID))
      .filter((value) => Number.isInteger(value) && value > 0);
  } finally {
    await connection.close();
  }
}
