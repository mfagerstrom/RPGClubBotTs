import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}
function mapImport(row) {
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
function mapItem(row) {
    return {
        itemId: Number(row.ITEM_ID),
        importId: Number(row.IMPORT_ID),
        rowIndex: Number(row.ROW_INDEX),
        gameTitle: row.GAME_TITLE,
        platformName: row.PLATFORM_NAME ?? null,
        regionName: row.REGION_NAME ?? null,
        sourceType: row.SOURCE_TYPE ?? null,
        timeText: row.TIME_TEXT ?? null,
        completedAt: row.COMPLETED_AT
            ? row.COMPLETED_AT instanceof Date
                ? row.COMPLETED_AT
                : new Date(row.COMPLETED_AT)
            : null,
        completionType: row.COMPLETION_TYPE ?? null,
        playtimeHours: row.PLAYTIME_HRS == null ? null : Number(row.PLAYTIME_HRS),
        status: row.STATUS,
        gameDbGameId: row.GAMEDB_GAME_ID == null ? null : Number(row.GAMEDB_GAME_ID),
        completionId: row.COMPLETION_ID == null ? null : Number(row.COMPLETION_ID),
        errorText: row.ERROR_TEXT ?? null,
    };
}
export async function createImportSession(params) {
    const connection = await getOraclePool().getConnection();
    try {
        const result = await connection.execute(`INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORTS (
         USER_ID, STATUS, CURRENT_INDEX, TOTAL_COUNT, SOURCE_FILENAME
       ) VALUES (
         :userId, 'ACTIVE', 0, :totalCount, :sourceFilename
       ) RETURNING IMPORT_ID INTO :id`, {
            userId: params.userId,
            totalCount: params.totalCount,
            sourceFilename: params.sourceFilename,
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        }, { autoCommit: true });
        const id = Number(result.outBinds?.id?.[0] ?? 0);
        if (!id) {
            throw new Error("Failed to create import session.");
        }
        const session = await getImportById(id, connection);
        if (!session) {
            throw new Error("Failed to load import session.");
        }
        return session;
    }
    finally {
        await connection.close();
    }
}
export async function insertImportItems(importId, items) {
    if (!items.length)
        return;
    const connection = await getOraclePool().getConnection();
    try {
        for (const item of items) {
            await connection.execute(`INSERT INTO RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS (
           IMPORT_ID,
           ROW_INDEX,
           GAME_TITLE,
           PLATFORM_NAME,
           REGION_NAME,
           SOURCE_TYPE,
           TIME_TEXT,
           COMPLETED_AT,
           COMPLETION_TYPE,
           PLAYTIME_HRS,
           STATUS
         ) VALUES (
           :importId,
           :rowIndex,
           :gameTitle,
           :platformName,
           :regionName,
           :sourceType,
           :timeText,
           :completedAt,
           :completionType,
           :playtimeHours,
           'PENDING'
         )`, {
                importId,
                rowIndex: item.rowIndex,
                gameTitle: item.gameTitle,
                platformName: item.platformName,
                regionName: item.regionName,
                sourceType: item.sourceType,
                timeText: item.timeText,
                completedAt: item.completedAt,
                completionType: item.completionType,
                playtimeHours: item.playtimeHours,
            }, { autoCommit: false });
        }
        await connection.commit();
    }
    catch (err) {
        await connection.rollback().catch(() => { });
        throw err;
    }
    finally {
        await connection.close();
    }
}
export async function getImportById(importId, existingConnection) {
    const connection = existingConnection ?? (await getOraclePool().getConnection());
    try {
        const res = await connection.execute(`SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              SOURCE_FILENAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
        WHERE IMPORT_ID = :id`, { id: importId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = res.rows?.[0];
        return row ? mapImport(row) : null;
    }
    finally {
        if (!existingConnection) {
            await connection.close();
        }
    }
}
export async function getActiveImportForUser(userId) {
    const connection = await getOraclePool().getConnection();
    try {
        const res = await connection.execute(`SELECT IMPORT_ID,
              USER_ID,
              STATUS,
              CURRENT_INDEX,
              TOTAL_COUNT,
              SOURCE_FILENAME,
              CREATED_AT,
              UPDATED_AT
         FROM RPG_CLUB_COMPLETIONATOR_IMPORTS
        WHERE USER_ID = :userId
          AND STATUS IN ('ACTIVE', 'PAUSED')
        ORDER BY CREATED_AT DESC, IMPORT_ID DESC
        FETCH FIRST 1 ROWS ONLY`, { userId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = res.rows?.[0];
        return row ? mapImport(row) : null;
    }
    finally {
        await connection.close();
    }
}
export async function setImportStatus(importId, status) {
    const connection = await getOraclePool().getConnection();
    try {
        await connection.execute(`UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
          SET STATUS = :status
        WHERE IMPORT_ID = :importId`, { status, importId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function updateImportIndex(importId, currentIndex) {
    const connection = await getOraclePool().getConnection();
    try {
        await connection.execute(`UPDATE RPG_CLUB_COMPLETIONATOR_IMPORTS
          SET CURRENT_INDEX = :currentIndex
        WHERE IMPORT_ID = :importId`, { currentIndex, importId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function getNextPendingItem(importId) {
    const connection = await getOraclePool().getConnection();
    try {
        const res = await connection.execute(`SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              GAME_TITLE,
              PLATFORM_NAME,
              REGION_NAME,
              SOURCE_TYPE,
              TIME_TEXT,
              COMPLETED_AT,
              COMPLETION_TYPE,
              PLAYTIME_HRS,
              STATUS,
              GAMEDB_GAME_ID,
              COMPLETION_ID,
              ERROR_TEXT
         FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
          AND STATUS = 'PENDING'
        ORDER BY ROW_INDEX ASC
        FETCH FIRST 1 ROWS ONLY`, { importId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = res.rows?.[0];
        return row ? mapItem(row) : null;
    }
    finally {
        await connection.close();
    }
}
export async function getImportItemById(itemId) {
    const connection = await getOraclePool().getConnection();
    try {
        const res = await connection.execute(`SELECT ITEM_ID,
              IMPORT_ID,
              ROW_INDEX,
              GAME_TITLE,
              PLATFORM_NAME,
              REGION_NAME,
              SOURCE_TYPE,
              TIME_TEXT,
              COMPLETED_AT,
              COMPLETION_TYPE,
              PLAYTIME_HRS,
              STATUS,
              GAMEDB_GAME_ID,
              COMPLETION_ID,
              ERROR_TEXT
         FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
        WHERE ITEM_ID = :itemId`, { itemId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const row = res.rows?.[0];
        return row ? mapItem(row) : null;
    }
    finally {
        await connection.close();
    }
}
export async function updateImportItem(itemId, updates) {
    const fields = [];
    const binds = { itemId };
    if (updates.status !== undefined) {
        fields.push("STATUS = :status");
        binds.status = updates.status;
    }
    if (updates.gameDbGameId !== undefined) {
        fields.push("GAMEDB_GAME_ID = :gameDbGameId");
        binds.gameDbGameId = updates.gameDbGameId;
    }
    if (updates.completionId !== undefined) {
        fields.push("COMPLETION_ID = :completionId");
        binds.completionId = updates.completionId;
    }
    if (updates.errorText !== undefined) {
        fields.push("ERROR_TEXT = :errorText");
        binds.errorText = updates.errorText;
    }
    if (!fields.length)
        return;
    const connection = await getOraclePool().getConnection();
    try {
        await connection.execute(`UPDATE RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
          SET ${fields.join(", ")}
        WHERE ITEM_ID = :itemId`, binds, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function countImportItems(importId) {
    const connection = await getOraclePool().getConnection();
    try {
        const res = await connection.execute(`SELECT STATUS, COUNT(*) AS CNT
         FROM RPG_CLUB_COMPLETIONATOR_IMPORT_ITEMS
        WHERE IMPORT_ID = :importId
        GROUP BY STATUS`, { importId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const stats = {
            pending: 0,
            skipped: 0,
            imported: 0,
            updated: 0,
            error: 0,
        };
        for (const row of res.rows ?? []) {
            const status = String(row.STATUS).toUpperCase();
            const count = Number(row.CNT ?? 0);
            if (status === "PENDING")
                stats.pending = count;
            if (status === "SKIPPED")
                stats.skipped = count;
            if (status === "IMPORTED")
                stats.imported = count;
            if (status === "UPDATED")
                stats.updated = count;
            if (status === "ERROR")
                stats.error = count;
        }
        return stats;
    }
    finally {
        await connection.close();
    }
}
