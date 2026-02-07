import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type CollectionCsvImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type CollectionCsvImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type CollectionCsvMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type CollectionCsvImportResultReason =
  | "AUTO_MATCH"
  | "CSV_GAMEDB_ID"
  | "CSV_IGDB_ID"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED"
  | "INVALID_ROW";

export interface ICollectionCsvImport {
  importId: number;
  userId: string;
  status: CollectionCsvImportStatus;
  currentIndex: number;
  totalCount: number;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICollectionCsvImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  rawTitle: string;
  rawPlatform: string | null;
  rawOwnershipType: string | null;
  rawNote: string | null;
  rawGameDbId: number | null;
  rawIgdbId: number | null;
  platformId: number | null;
  ownershipType: string | null;
  note: string | null;
  status: CollectionCsvImportItemStatus;
  matchConfidence: CollectionCsvMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: CollectionCsvImportResultReason | null;
  errorText: string | null;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapImport(row: {
  IMPORT_ID: number;
  USER_ID: string;
  STATUS: CollectionCsvImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  SOURCE_FILE_NAME: string | null;
  SOURCE_FILE_SIZE: number | null;
  TEMPLATE_VERSION: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): ICollectionCsvImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
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
  RAW_TITLE: string;
  RAW_PLATFORM: string | null;
  RAW_OWNERSHIP_TYPE: string | null;
  RAW_NOTE: string | null;
  RAW_GAMEDB_ID: number | null;
  RAW_IGDB_ID: number | null;
  PLATFORM_ID: number | null;
  OWNERSHIP_TYPE: string | null;
  NOTE: string | null;
  STATUS: CollectionCsvImportItemStatus;
  MATCH_CONFIDENCE: CollectionCsvMatchConfidence | null;
  MATCH_CANDIDATE_JSON: string | null;
  GAMEDB_GAME_ID: number | null;
  COLLECTION_ENTRY_ID: number | null;
  RESULT_REASON: CollectionCsvImportResultReason | null;
  ERROR_TEXT: string | null;
}): ICollectionCsvImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    rawTitle: row.RAW_TITLE,
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

export async function createCollectionCsvImportSession(params: {
  userId: string;
  totalCount: number;
  sourceFileName: string | null;
  sourceFileSize: number | null;
  templateVersion: string | null;
}): Promise<ICollectionCsvImport> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_COLLECTION_CSV_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         SOURCE_FILE_NAME,
         SOURCE_FILE_SIZE,
         TEMPLATE_VERSION
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :sourceFileName,
         :sourceFileSize,
         :templateVersion
       ) RETURNING IMPORT_ID INTO :id`,
      {
        userId: params.userId,
        totalCount: params.totalCount,
        sourceFileName: params.sourceFileName,
        sourceFileSize: params.sourceFileSize,
        templateVersion: params.templateVersion,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );

    const id = Number((result.outBinds as { id?: number[] }).id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create CSV collection import session.");
    }

    const session = await getCollectionCsvImportById(id, connection);
    if (!session) {
      throw new Error("Failed to load CSV collection import session.");
    }

    return session;
  } finally {
    await connection.close();
  }
}

export async function insertCollectionCsvImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    rawTitle: string;
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
        `INSERT INTO RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           RAW_TITLE,
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
           :rawTitle,
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
          rawTitle: item.rawTitle,
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

export async function getCollectionCsvImportById(
  importId: number,
  existingConnection?: oracledb.Connection,
): Promise<ICollectionCsvImport | null> {
  const connection = existingConnection ?? await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: CollectionCsvImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
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
              SOURCE_FILE_NAME,
              SOURCE_FILE_SIZE,
              TEMPLATE_VERSION,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_COLLECTION_CSV_IMPORTS
        WHERE IMPORT_ID = :importId`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    if (!existingConnection) {
      await connection.close();
    }
  }
}

export async function getActiveCollectionCsvImportForUser(
  userId: string,
): Promise<ICollectionCsvImport | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: CollectionCsvImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
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
              SOURCE_FILE_NAME,
              SOURCE_FILE_SIZE,
              TEMPLATE_VERSION,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_COLLECTION_CSV_IMPORTS
        WHERE USER_ID = :userId
          AND STATUS IN ('ACTIVE', 'PAUSED')
        ORDER BY CREATED_AT DESC, IMPORT_ID DESC
        FETCH FIRST 1 ROWS ONLY`,
      { userId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapImport(row) : null;
  } finally {
    await connection.close();
  }
}

export async function setCollectionCsvImportStatus(
  importId: number,
  status: CollectionCsvImportStatus,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`,
      { status, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateCollectionCsvImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`,
      { currentIndex, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getCollectionCsvImportItemById(
  itemId: number,
): Promise<ICollectionCsvImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      RAW_TITLE: string;
      RAW_PLATFORM: string | null;
      RAW_OWNERSHIP_TYPE: string | null;
      RAW_NOTE: string | null;
      RAW_GAMEDB_ID: number | null;
      RAW_IGDB_ID: number | null;
      PLATFORM_ID: number | null;
      OWNERSHIP_TYPE: string | null;
      NOTE: string | null;
      STATUS: CollectionCsvImportItemStatus;
      MATCH_CONFIDENCE: CollectionCsvMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: CollectionCsvImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              RAW_TITLE,
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
         FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
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

export async function getNextPendingCollectionCsvImportItem(
  importId: number,
): Promise<ICollectionCsvImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      RAW_TITLE: string;
      RAW_PLATFORM: string | null;
      RAW_OWNERSHIP_TYPE: string | null;
      RAW_NOTE: string | null;
      RAW_GAMEDB_ID: number | null;
      RAW_IGDB_ID: number | null;
      PLATFORM_ID: number | null;
      OWNERSHIP_TYPE: string | null;
      NOTE: string | null;
      STATUS: CollectionCsvImportItemStatus;
      MATCH_CONFIDENCE: CollectionCsvMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: CollectionCsvImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              RAW_TITLE,
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
         FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX ASC, ITEM_ID ASC
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

export async function updateCollectionCsvImportItem(
  itemId: number,
  updates: {
    status?: CollectionCsvImportItemStatus;
    matchConfidence?: CollectionCsvMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: CollectionCsvImportResultReason | null;
    errorText?: string | null;
  },
): Promise<void> {
  const setParts: string[] = [];
  const binds: Record<string, string | number | null> = { itemId };

  if (updates.status !== undefined) {
    setParts.push("STATUS = :status");
    binds.status = updates.status;
  }
  if (updates.matchConfidence !== undefined) {
    setParts.push("MATCH_CONFIDENCE = :matchConfidence");
    binds.matchConfidence = updates.matchConfidence;
  }
  if (updates.matchCandidateJson !== undefined) {
    setParts.push("MATCH_CANDIDATE_JSON = :matchCandidateJson");
    binds.matchCandidateJson = updates.matchCandidateJson;
  }
  if (updates.gameDbGameId !== undefined) {
    setParts.push("GAMEDB_GAME_ID = :gameDbGameId");
    binds.gameDbGameId = updates.gameDbGameId;
  }
  if (updates.collectionEntryId !== undefined) {
    setParts.push("COLLECTION_ENTRY_ID = :collectionEntryId");
    binds.collectionEntryId = updates.collectionEntryId;
  }
  if (updates.resultReason !== undefined) {
    setParts.push("RESULT_REASON = :resultReason");
    binds.resultReason = updates.resultReason;
  }
  if (updates.errorText !== undefined) {
    setParts.push("ERROR_TEXT = :errorText");
    binds.errorText = updates.errorText;
  }

  if (!setParts.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
          SET ${setParts.join(", ")}
        WHERE ITEM_ID = :itemId`,
      binds,
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function countCollectionCsvImportItems(
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
      STATUS: CollectionCsvImportItemStatus;
      TOTAL: number;
    }>(
      `SELECT STATUS, COUNT(*) AS TOTAL
         FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY STATUS`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const counts: Record<CollectionCsvImportItemStatus, number> = {
      PENDING: 0,
      ADDED: 0,
      UPDATED: 0,
      SKIPPED: 0,
      FAILED: 0,
    };
    result.rows?.forEach((row) => {
      const status = row.STATUS;
      counts[status] = Number(row.TOTAL ?? 0);
    });
    return {
      pending: counts.PENDING,
      added: counts.ADDED,
      updated: counts.UPDATED,
      skipped: counts.SKIPPED,
      failed: counts.FAILED,
    };
  } finally {
    await connection.close();
  }
}

export async function countCollectionCsvImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      RESULT_REASON: CollectionCsvImportResultReason;
      TOTAL: number;
    }>(
      `SELECT RESULT_REASON, COUNT(*) AS TOTAL
         FROM RPG_CLUB_COLLECTION_CSV_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND RESULT_REASON IS NOT NULL
        GROUP BY RESULT_REASON`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const counts: Record<string, number> = {};
    result.rows?.forEach((row) => {
      counts[String(row.RESULT_REASON)] = Number(row.TOTAL ?? 0);
    });
    return counts;
  } finally {
    await connection.close();
  }
}
