import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export type SteamCollectionImportStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELED";
export type SteamCollectionImportItemStatus =
  | "PENDING"
  | "ADDED"
  | "UPDATED"
  | "SKIPPED"
  | "FAILED";
export type SteamCollectionMatchConfidence = "EXACT" | "FUZZY" | "MANUAL";
export type SteamAppGameDbMapStatus = "MAPPED" | "SKIPPED";
export type SteamCollectionImportResultReason =
  | "AUTO_MATCH"
  | "MANUAL_REMAP"
  | "DUPLICATE"
  | "MANUAL_SKIP"
  | "SKIP_MAPPED"
  | "NO_CANDIDATE"
  | "INVALID_REMAP"
  | "PLATFORM_UNRESOLVED"
  | "ADD_FAILED";

export interface ISteamCollectionImport {
  importId: number;
  userId: string;
  status: SteamCollectionImportStatus;
  currentIndex: number;
  totalCount: number;
  steamId64: string;
  steamProfileRef: string | null;
  sourceProfileName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISteamCollectionImportItem {
  itemId: number;
  importId: number;
  rowIndex: number;
  steamAppId: number;
  steamAppName: string;
  playtimeForeverMin: number | null;
  playtimeWindowsMin: number | null;
  playtimeMacMin: number | null;
  playtimeLinuxMin: number | null;
  playtimeDeckMin: number | null;
  lastPlayedAt: Date | null;
  status: SteamCollectionImportItemStatus;
  matchConfidence: SteamCollectionMatchConfidence | null;
  matchCandidateJson: string | null;
  gameDbGameId: number | null;
  collectionEntryId: number | null;
  resultReason: SteamCollectionImportResultReason | null;
  errorText: string | null;
}

export interface ISteamAppGameDbMap {
  mapId: number;
  steamAppId: number;
  gameDbGameId: number | null;
  status: SteamAppGameDbMapStatus;
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
  STATUS: SteamCollectionImportStatus;
  CURRENT_INDEX: number;
  TOTAL_COUNT: number;
  STEAM_ID64: string;
  STEAM_PROFILE_REF: string | null;
  SOURCE_PROFILE_NAME: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): ISteamCollectionImport {
  return {
    importId: Number(row.IMPORT_ID),
    userId: row.USER_ID,
    status: row.STATUS,
    currentIndex: Number(row.CURRENT_INDEX ?? 0),
    totalCount: Number(row.TOTAL_COUNT ?? 0),
    steamId64: row.STEAM_ID64,
    steamProfileRef: row.STEAM_PROFILE_REF ?? null,
    sourceProfileName: row.SOURCE_PROFILE_NAME ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

function mapItem(row: {
  ITEM_ID: number;
  IMPORT_ID: number;
  ROW_INDEX: number;
  STEAM_APP_ID: number;
  STEAM_APP_NAME: string;
  PLAYTIME_FOREVER_MIN: number | null;
  PLAYTIME_WINDOWS_MIN: number | null;
  PLAYTIME_MAC_MIN: number | null;
  PLAYTIME_LINUX_MIN: number | null;
  PLAYTIME_DECK_MIN: number | null;
  LAST_PLAYED_AT: Date | string | null;
  STATUS: SteamCollectionImportItemStatus;
  MATCH_CONFIDENCE: SteamCollectionMatchConfidence | null;
  MATCH_CANDIDATE_JSON: string | null;
  GAMEDB_GAME_ID: number | null;
  COLLECTION_ENTRY_ID: number | null;
  RESULT_REASON: SteamCollectionImportResultReason | null;
  ERROR_TEXT: string | null;
}): ISteamCollectionImportItem {
  return {
    itemId: Number(row.ITEM_ID),
    importId: Number(row.IMPORT_ID),
    rowIndex: Number(row.ROW_INDEX),
    steamAppId: Number(row.STEAM_APP_ID),
    steamAppName: row.STEAM_APP_NAME,
    playtimeForeverMin: row.PLAYTIME_FOREVER_MIN == null
      ? null
      : Number(row.PLAYTIME_FOREVER_MIN),
    playtimeWindowsMin: row.PLAYTIME_WINDOWS_MIN == null
      ? null
      : Number(row.PLAYTIME_WINDOWS_MIN),
    playtimeMacMin: row.PLAYTIME_MAC_MIN == null ? null : Number(row.PLAYTIME_MAC_MIN),
    playtimeLinuxMin: row.PLAYTIME_LINUX_MIN == null ? null : Number(row.PLAYTIME_LINUX_MIN),
    playtimeDeckMin: row.PLAYTIME_DECK_MIN == null ? null : Number(row.PLAYTIME_DECK_MIN),
    lastPlayedAt: row.LAST_PLAYED_AT ? toDate(row.LAST_PLAYED_AT) : null,
    status: row.STATUS,
    matchConfidence: row.MATCH_CONFIDENCE ?? null,
    matchCandidateJson: row.MATCH_CANDIDATE_JSON ?? null,
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    collectionEntryId: row.COLLECTION_ENTRY_ID == null ? null : Number(row.COLLECTION_ENTRY_ID),
    resultReason: row.RESULT_REASON ?? null,
    errorText: row.ERROR_TEXT ?? null,
  };
}

function mapAppMap(row: {
  MAP_ID: number;
  STEAM_APP_ID: number;
  GAMEDB_GAME_ID: number | null;
  STATUS: SteamAppGameDbMapStatus;
  CREATED_BY: string | null;
  CREATED_AT: Date | string;
  UPDATED_AT: Date | string;
}): ISteamAppGameDbMap {
  return {
    mapId: Number(row.MAP_ID),
    steamAppId: Number(row.STEAM_APP_ID),
    gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
    status: row.STATUS,
    createdBy: row.CREATED_BY ?? null,
    createdAt: toDate(row.CREATED_AT),
    updatedAt: toDate(row.UPDATED_AT),
  };
}

export async function createSteamCollectionImportSession(params: {
  userId: string;
  totalCount: number;
  steamId64: string;
  steamProfileRef: string | null;
  sourceProfileName: string | null;
}): Promise<ISteamCollectionImport> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute(
      `INSERT INTO RPG_CLUB_STEAM_COLLECTION_IMPORTS (
         USER_ID,
         STATUS,
         CURRENT_INDEX,
         TOTAL_COUNT,
         STEAM_ID64,
         STEAM_PROFILE_REF,
         SOURCE_PROFILE_NAME
       ) VALUES (
         :userId,
         'ACTIVE',
         0,
         :totalCount,
         :steamId64,
         :steamProfileRef,
         :sourceProfileName
       ) RETURNING IMPORT_ID INTO :id`,
      {
        userId: params.userId,
        totalCount: params.totalCount,
        steamId64: params.steamId64,
        steamProfileRef: params.steamProfileRef,
        sourceProfileName: params.sourceProfileName,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: true },
    );

    const id = Number((result.outBinds as { id?: number[] }).id?.[0] ?? 0);
    if (!id) {
      throw new Error("Failed to create Steam collection import session.");
    }

    const session = await getSteamCollectionImportById(id, connection);
    if (!session) {
      throw new Error("Failed to load Steam collection import session.");
    }

    return session;
  } finally {
    await connection.close();
  }
}

export async function insertSteamCollectionImportItems(
  importId: number,
  items: Array<{
    rowIndex: number;
    steamAppId: number;
    steamAppName: string;
    playtimeForeverMin: number | null;
    playtimeWindowsMin: number | null;
    playtimeMacMin: number | null;
    playtimeLinuxMin: number | null;
    playtimeDeckMin: number | null;
    lastPlayedAt: Date | null;
  }>,
): Promise<void> {
  if (!items.length) return;

  const connection = await getOraclePool().getConnection();
  try {
    for (const item of items) {
      await connection.execute(
        `INSERT INTO RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           STEAM_APP_ID,
           STEAM_APP_NAME,
           PLAYTIME_FOREVER_MIN,
           PLAYTIME_WINDOWS_MIN,
           PLAYTIME_MAC_MIN,
           PLAYTIME_LINUX_MIN,
           PLAYTIME_DECK_MIN,
           LAST_PLAYED_AT,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :steamAppId,
           :steamAppName,
           :playtimeForeverMin,
           :playtimeWindowsMin,
           :playtimeMacMin,
           :playtimeLinuxMin,
           :playtimeDeckMin,
           :lastPlayedAt,
           'PENDING'
         )`,
        {
          importId,
          rowIndex: item.rowIndex,
          steamAppId: item.steamAppId,
          steamAppName: item.steamAppName,
          playtimeForeverMin: item.playtimeForeverMin,
          playtimeWindowsMin: item.playtimeWindowsMin,
          playtimeMacMin: item.playtimeMacMin,
          playtimeLinuxMin: item.playtimeLinuxMin,
          playtimeDeckMin: item.playtimeDeckMin,
          lastPlayedAt: item.lastPlayedAt,
        },
        { autoCommit: false },
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    await connection.close();
  }
}

export async function getSteamCollectionImportById(
  importId: number,
  existingConnection?: oracledb.Connection,
): Promise<ISteamCollectionImport | null> {
  const connection = existingConnection ?? (await getOraclePool().getConnection());
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: SteamCollectionImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      STEAM_ID64: string;
      STEAM_PROFILE_REF: string | null;
      SOURCE_PROFILE_NAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              STEAM_ID64,
              STEAM_PROFILE_REF,
              SOURCE_PROFILE_NAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS
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

export async function getActiveSteamCollectionImportForUser(
  userId: string,
): Promise<ISteamCollectionImport | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      IMPORT_ID: number;
      USER_ID: string;
      STATUS: SteamCollectionImportStatus;
      CURRENT_INDEX: number;
      TOTAL_COUNT: number;
      STEAM_ID64: string;
      STEAM_PROFILE_REF: string | null;
      SOURCE_PROFILE_NAME: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              STEAM_ID64,
              STEAM_PROFILE_REF,
              SOURCE_PROFILE_NAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORTS
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

export async function setSteamCollectionImportStatus(
  importId: number,
  status: SteamCollectionImportStatus,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`,
      { status, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateSteamCollectionImportIndex(
  importId: number,
  currentIndex: number,
): Promise<void> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`,
      { currentIndex, importId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function getSteamCollectionImportItemById(
  itemId: number,
): Promise<ISteamCollectionImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      STEAM_APP_ID: number;
      STEAM_APP_NAME: string;
      PLAYTIME_FOREVER_MIN: number | null;
      PLAYTIME_WINDOWS_MIN: number | null;
      PLAYTIME_MAC_MIN: number | null;
      PLAYTIME_LINUX_MIN: number | null;
      PLAYTIME_DECK_MIN: number | null;
      LAST_PLAYED_AT: Date | string | null;
      STATUS: SteamCollectionImportItemStatus;
      MATCH_CONFIDENCE: SteamCollectionMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: SteamCollectionImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              STEAM_APP_ID,
              STEAM_APP_NAME,
              PLAYTIME_FOREVER_MIN,
              PLAYTIME_WINDOWS_MIN,
              PLAYTIME_MAC_MIN,
              PLAYTIME_LINUX_MIN,
              PLAYTIME_DECK_MIN,
              LAST_PLAYED_AT,
              STATUS,
              MATCH_CONFIDENCE,
              MATCH_CANDIDATE_JSON,
              GAMEDB_GAME_ID,
              COLLECTION_ENTRY_ID,
              RESULT_REASON,
              ERROR_TEXT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
        WHERE ITEM_ID = :itemId`,
      { itemId },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: {
          MATCH_CANDIDATE_JSON: { type: oracledb.STRING },
        },
      },
    );
    const row = result.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function getNextPendingSteamCollectionImportItem(
  importId: number,
): Promise<ISteamCollectionImportItem | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      ITEM_ID: number;
      IMPORT_ID: number;
      ROW_INDEX: number;
      STEAM_APP_ID: number;
      STEAM_APP_NAME: string;
      PLAYTIME_FOREVER_MIN: number | null;
      PLAYTIME_WINDOWS_MIN: number | null;
      PLAYTIME_MAC_MIN: number | null;
      PLAYTIME_LINUX_MIN: number | null;
      PLAYTIME_DECK_MIN: number | null;
      LAST_PLAYED_AT: Date | string | null;
      STATUS: SteamCollectionImportItemStatus;
      MATCH_CONFIDENCE: SteamCollectionMatchConfidence | null;
      MATCH_CANDIDATE_JSON: string | null;
      GAMEDB_GAME_ID: number | null;
      COLLECTION_ENTRY_ID: number | null;
      RESULT_REASON: SteamCollectionImportResultReason | null;
      ERROR_TEXT: string | null;
    }>(
      `SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              STEAM_APP_ID,
              STEAM_APP_NAME,
              PLAYTIME_FOREVER_MIN,
              PLAYTIME_WINDOWS_MIN,
              PLAYTIME_MAC_MIN,
              PLAYTIME_LINUX_MIN,
              PLAYTIME_DECK_MIN,
              LAST_PLAYED_AT,
              STATUS,
              MATCH_CONFIDENCE,
              MATCH_CANDIDATE_JSON,
              GAMEDB_GAME_ID,
              COLLECTION_ENTRY_ID,
              RESULT_REASON,
              ERROR_TEXT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX ASC
        FETCH FIRST 1 ROWS ONLY`,
      { importId },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: {
          MATCH_CANDIDATE_JSON: { type: oracledb.STRING },
        },
      },
    );
    const row = result.rows?.[0];
    return row ? mapItem(row) : null;
  } finally {
    await connection.close();
  }
}

export async function updateSteamCollectionImportItem(
  itemId: number,
  updates: {
    status?: SteamCollectionImportItemStatus;
    matchConfidence?: SteamCollectionMatchConfidence | null;
    matchCandidateJson?: string | null;
    gameDbGameId?: number | null;
    collectionEntryId?: number | null;
    resultReason?: SteamCollectionImportResultReason | null;
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

  if (!setParts.length) {
    return;
  }

  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `UPDATE RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
          SET ${setParts.join(", ")}
        WHERE ITEM_ID = :itemId`,
      binds,
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function countSteamCollectionImportItems(
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
      STATUS: SteamCollectionImportItemStatus;
      CNT: number;
    }>(
      `SELECT STATUS, COUNT(*) AS CNT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
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
      const status = String(row.STATUS).toUpperCase();
      const value = Number(row.CNT ?? 0);
      if (status === "PENDING") counts.pending = value;
      else if (status === "ADDED") counts.added = value;
      else if (status === "UPDATED") counts.updated = value;
      else if (status === "SKIPPED") counts.skipped = value;
      else if (status === "FAILED") counts.failed = value;
    }

    return counts;
  } finally {
    await connection.close();
  }
}

export async function countSteamCollectionImportResultReasons(
  importId: number,
): Promise<Record<string, number>> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      RESULT_REASON: string | null;
      CNT: number;
    }>(
      `SELECT RESULT_REASON, COUNT(*) AS CNT
         FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND RESULT_REASON IS NOT NULL
        GROUP BY RESULT_REASON`,
      { importId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const counts: Record<string, number> = {};
    for (const row of result.rows ?? []) {
      const key = String(row.RESULT_REASON ?? "").trim();
      if (!key.length) continue;
      counts[key] = Number(row.CNT ?? 0);
    }
    return counts;
  } finally {
    await connection.close();
  }
}

export async function getSteamAppGameDbMapByAppId(
  steamAppId: number,
): Promise<ISteamAppGameDbMap | null> {
  const connection = await getOraclePool().getConnection();
  try {
    const result = await connection.execute<{
      MAP_ID: number;
      STEAM_APP_ID: number;
      GAMEDB_GAME_ID: number | null;
      STATUS: SteamAppGameDbMapStatus;
      CREATED_BY: string | null;
      CREATED_AT: Date | string;
      UPDATED_AT: Date | string;
    }>(
      `SELECT MAP_ID,
              STEAM_APP_ID,
              GAMEDB_GAME_ID,
              STATUS,
              CREATED_BY,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_STEAM_APP_GAMEDB_MAP
        WHERE STEAM_APP_ID = :steamAppId`,
      { steamAppId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const row = result.rows?.[0];
    return row ? mapAppMap(row) : null;
  } finally {
    await connection.close();
  }
}

export async function upsertSteamAppGameDbMap(params: {
  steamAppId: number;
  gameDbGameId: number | null;
  status: SteamAppGameDbMapStatus;
  createdBy: string | null;
}): Promise<ISteamAppGameDbMap> {
  const connection = await getOraclePool().getConnection();
  try {
    await connection.execute(
      `MERGE INTO RPG_CLUB_STEAM_APP_GAMEDB_MAP m
       USING (
         SELECT :steamAppId AS steamAppId,
                :gameDbGameId AS gameDbGameId,
                :status AS status,
                :createdBy AS createdBy
           FROM dual
       ) src
          ON (m.STEAM_APP_ID = src.steamAppId)
       WHEN MATCHED THEN UPDATE SET
         m.GAMEDB_GAME_ID = src.gameDbGameId,
         m.STATUS = src.status,
         m.CREATED_BY = src.createdBy
       WHEN NOT MATCHED THEN INSERT (
         STEAM_APP_ID,
         GAMEDB_GAME_ID,
         STATUS,
         CREATED_BY
       ) VALUES (
         src.steamAppId,
         src.gameDbGameId,
         src.status,
         src.createdBy
       )`,
      {
        steamAppId: params.steamAppId,
        gameDbGameId: params.gameDbGameId,
        status: params.status,
        createdBy: params.createdBy,
      },
      { autoCommit: true },
    );

    const mapping = await getSteamAppGameDbMapByAppId(params.steamAppId);
    if (!mapping) {
      throw new Error("Failed to load Steam app mapping.");
    }
    return mapping;
  } finally {
    await connection.close();
  }
}

export async function getSteamAppHistoricalMappedGameIds(params: {
  steamAppId: number;
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
             FROM RPG_CLUB_STEAM_COLLECTION_IMPORT_ITEMS ii
             JOIN RPG_CLUB_STEAM_COLLECTION_IMPORTS i
               ON i.IMPORT_ID = ii.IMPORT_ID
            WHERE ii.STEAM_APP_ID = :steamAppId
              AND ii.GAMEDB_GAME_ID IS NOT NULL
              AND ii.RESULT_REASON = 'MANUAL_REMAP'
              AND (:excludeUserId IS NULL OR i.USER_ID <> :excludeUserId)
            GROUP BY ii.GAMEDB_GAME_ID
            ORDER BY CNT DESC, LAST_ITEM_ID DESC
         ) t
        WHERE ROWNUM <= :limit`,
      {
        steamAppId: params.steamAppId,
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
