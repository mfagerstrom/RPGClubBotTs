import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
const IGDB_REGION_MAP = {
    1: { code: "EU", name: "Europe" },
    2: { code: "NA", name: "North America" },
    3: { code: "AUS", name: "Australia" },
    4: { code: "NZ", name: "New Zealand" },
    5: { code: "JP", name: "Japan" },
    6: { code: "CN", name: "China" },
    7: { code: "AS", name: "Asia" },
    8: { code: "WW", name: "Worldwide" },
};
const buildPlatformCode = (name, igdbId) => {
    const platformName = name ?? `IGDB Platform ${igdbId}`;
    const sanitized = platformName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const base = sanitized.slice(0, 12) || "PLATFORM";
    const codeWithId = `${base}${igdbId}`;
    return codeWithId.length > 20 ? codeWithId.slice(0, 20) : codeWithId;
};
// Helper functions for mapping rows
function mapGameRow(row) {
    return {
        id: Number(row.GAME_ID),
        title: String(row.TITLE),
        description: row.DESCRIPTION ? String(row.DESCRIPTION) : null,
        imageData: row.IMAGE_DATA instanceof Buffer ? row.IMAGE_DATA : null,
        igdbId: row.IGDB_ID ? Number(row.IGDB_ID) : null,
        slug: row.SLUG ? String(row.SLUG) : null,
        totalRating: row.TOTAL_RATING ? Number(row.TOTAL_RATING) : null,
        igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
        createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
        updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
    };
}
function mapReleaseRow(row) {
    return {
        id: Number(row.RELEASE_ID),
        gameId: Number(row.GAME_ID),
        platformId: Number(row.PLATFORM_ID),
        regionId: Number(row.REGION_ID),
        format: row.FORMAT ? String(row.FORMAT) : null,
        releaseDate: row.RELEASE_DATE instanceof Date ? row.RELEASE_DATE : (row.RELEASE_DATE ? new Date(row.RELEASE_DATE) : null),
        notes: row.NOTES ? String(row.NOTES) : null,
    };
}
function mapPlatformDefRow(row) {
    return {
        id: Number(row.PLATFORM_ID),
        code: String(row.PLATFORM_CODE),
        name: String(row.PLATFORM_NAME),
        igdbPlatformId: row.IGDB_PLATFORM_ID ? Number(row.IGDB_PLATFORM_ID) : null,
    };
}
function mapRegionDefRow(row) {
    return {
        id: Number(row.REGION_ID),
        code: String(row.REGION_CODE),
        name: String(row.REGION_NAME),
        igdbRegionId: row.IGDB_REGION_ID ? Number(row.IGDB_REGION_ID) : null,
    };
}
export default class Game {
    static async createGame(title, description, imageData, igdbId = null, slug = null, totalRating = null, igdbUrl = null) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`INSERT INTO GAMEDB_GAMES (TITLE, DESCRIPTION, IMAGE_DATA, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL)
         VALUES (:title, :description, :imageData, :igdbId, :slug, :totalRating, :igdbUrl)
         RETURNING GAME_ID INTO :id`, {
                title,
                description,
                imageData: imageData || null,
                igdbId: igdbId || null,
                slug: slug || null,
                totalRating: totalRating || null,
                igdbUrl: igdbUrl || null,
                id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
            }, { autoCommit: true });
            const gameId = result.outBinds.id[0];
            if (!gameId) {
                throw new Error("Failed to retrieve GAME_ID after insert.");
            }
            const newGame = await Game.getGameById(gameId);
            if (!newGame) {
                throw new Error("Failed to fetch newly created game.");
            }
            return newGame;
        }
        finally {
            await connection.close();
        }
    }
    static async getGameById(id) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL, CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE GAME_ID = :id`, { id }, {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: {
                    "IMAGE_DATA": { type: oracledb.BUFFER },
                    "DESCRIPTION": { type: oracledb.STRING }
                }
            });
            const row = (result.rows ?? [])[0];
            return row ? mapGameRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getGamesByIds(ids) {
        const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
        if (!uniqueIds.length)
            return [];
        const binds = {};
        const placeholders = [];
        uniqueIds.forEach((id, idx) => {
            const key = `id${idx}`;
            binds[key] = id;
            placeholders.push(`:${key}`);
        });
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, IGDB_ID, SLUG, TOTAL_RATING,
                IGDB_URL, CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE GAME_ID IN (${placeholders.join(", ")})`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (result.rows ?? []).map((row) => mapGameRow(row));
        }
        finally {
            await connection.close();
        }
    }
    static async getAlternateVersions(gameId) {
        if (!Number.isInteger(gameId) || gameId <= 0)
            return [];
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, IGDB_ID, SLUG, TOTAL_RATING,
                IGDB_URL, CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE GAME_ID IN (
            SELECT CASE
                     WHEN GAME_ID = :id THEN ALT_GAME_ID
                     ELSE GAME_ID
                   END
              FROM GAMEDB_GAME_ALTERNATES
             WHERE GAME_ID = :id OR ALT_GAME_ID = :id
          )
          ORDER BY UPPER(TITLE)`, { id: gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (result.rows ?? []).map((row) => mapGameRow(row));
        }
        finally {
            await connection.close();
        }
    }
    static async linkAlternateVersions(gameIds, createdBy) {
        const uniqueIds = Array.from(new Set(gameIds.filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
        if (uniqueIds.length < 2) {
            throw new Error("At least two GameDB ids are required to link versions.");
        }
        const pairs = [];
        for (let i = 0; i < uniqueIds.length; i += 1) {
            for (let j = i + 1; j < uniqueIds.length; j += 1) {
                pairs.push({
                    gameId: uniqueIds[i],
                    altGameId: uniqueIds[j],
                    createdBy,
                });
            }
        }
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            await connection.executeMany(`MERGE INTO GAMEDB_GAME_ALTERNATES t
         USING (
           SELECT :gameId AS GAME_ID,
                  :altGameId AS ALT_GAME_ID,
                  :createdBy AS CREATED_BY
             FROM dual
         ) s
            ON (t.GAME_ID = s.GAME_ID AND t.ALT_GAME_ID = s.ALT_GAME_ID)
         WHEN NOT MATCHED THEN
           INSERT (GAME_ID, ALT_GAME_ID, CREATED_BY)
           VALUES (s.GAME_ID, s.ALT_GAME_ID, s.CREATED_BY)`, pairs, { autoCommit: true });
            return pairs.length;
        }
        finally {
            await connection.close();
        }
    }
    static async getGameByIgdbId(igdbId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT GAME_ID, TITLE, DESCRIPTION, IMAGE_DATA, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL,
                CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE IGDB_ID = :igdbId`, { igdbId }, {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: {
                    IMAGE_DATA: { type: oracledb.BUFFER },
                    DESCRIPTION: { type: oracledb.STRING },
                },
            });
            const row = (result.rows ?? [])[0];
            return row ? mapGameRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    // --- Metadata Handlers ---
    static async getOrInsertMetadata(connection, table, idCol, nameCol, igdbIdCol, name, igdbId) {
        const findRes = await connection.execute(`SELECT ${idCol} FROM ${table} WHERE ${igdbIdCol} = :igdbId`, { igdbId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (findRes.rows && findRes.rows.length > 0) {
            return Number(findRes.rows[0][idCol]);
        }
        const insertRes = await connection.execute(`INSERT INTO ${table} (${nameCol}, ${igdbIdCol}) VALUES (:name, :igdbId) RETURNING ${idCol} INTO :id`, { name, igdbId, id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT } }, { autoCommit: true });
        return insertRes.outBinds.id[0];
    }
    static async saveFullGameMetadata(gameId, details) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            // Companies
            if (details.involved_companies) {
                for (const ic of details.involved_companies) {
                    const companyId = await Game.getOrInsertMetadata(connection, "GAMEDB_COMPANIES", "COMPANY_ID", "NAME", "IGDB_COMPANY_ID", ic.company.name, ic.company.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_COMPANIES (GAME_ID, COMPANY_ID, ROLE)
             VALUES (:gameId, :companyId, :role)`, {
                        gameId,
                        companyId,
                        role: ic.developer ? "Developer" : (ic.publisher ? "Publisher" : null),
                    }, { autoCommit: true }).catch(() => { });
                }
            }
            // Genres
            if (details.genres) {
                for (const g of details.genres) {
                    const genreId = await Game.getOrInsertMetadata(connection, "GAMEDB_GENRES", "GENRE_ID", "NAME", "IGDB_GENRE_ID", g.name, g.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_GENRES (GAME_ID, GENRE_ID) VALUES (:gameId, :genreId)`, { gameId, genreId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Themes
            if (details.themes) {
                for (const t of details.themes) {
                    const themeId = await Game.getOrInsertMetadata(connection, "GAMEDB_THEMES", "THEME_ID", "NAME", "IGDB_THEME_ID", t.name, t.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_THEMES (GAME_ID, THEME_ID) VALUES (:gameId, :themeId)`, { gameId, themeId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Game Modes
            if (details.game_modes) {
                for (const gm of details.game_modes) {
                    const modeId = await Game.getOrInsertMetadata(connection, "GAMEDB_GAME_MODES_DEF", "MODE_ID", "NAME", "IGDB_GAME_MODE_ID", gm.name, gm.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_MODES (GAME_ID, MODE_ID) VALUES (:gameId, :modeId)`, { gameId, modeId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Perspectives
            if (details.player_perspectives) {
                for (const pp of details.player_perspectives) {
                    const persId = await Game.getOrInsertMetadata(connection, "GAMEDB_PERSPECTIVES", "PERSPECTIVE_ID", "NAME", "IGDB_PERSPECTIVE_ID", pp.name, pp.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_PERSPECTIVES (GAME_ID, PERSPECTIVE_ID)
             VALUES (:gameId, :persId)`, { gameId, persId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Engines
            if (details.game_engines) {
                for (const e of details.game_engines) {
                    const engineId = await Game.getOrInsertMetadata(connection, "GAMEDB_ENGINES", "ENGINE_ID", "NAME", "IGDB_ENGINE_ID", e.name, e.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_ENGINES (GAME_ID, ENGINE_ID) VALUES (:gameId, :engineId)`, { gameId, engineId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Franchises
            if (details.franchises) {
                for (const f of details.franchises) {
                    const franchiseId = await Game.getOrInsertMetadata(connection, "GAMEDB_FRANCHISES", "FRANCHISE_ID", "NAME", "IGDB_FRANCHISE_ID", f.name, f.id);
                    await connection.execute(`INSERT INTO GAMEDB_GAME_FRANCHISES (GAME_ID, FRANCHISE_ID) VALUES (:gameId, :franchiseId)`, { gameId, franchiseId }, { autoCommit: true }).catch(() => { });
                }
            }
            // Collection (Series)
            if (details.collection) {
                const collectionId = await Game.getOrInsertMetadata(connection, "GAMEDB_COLLECTIONS", "COLLECTION_ID", "NAME", "IGDB_COLLECTION_ID", details.collection.name, details.collection.id);
                await connection.execute(`UPDATE GAMEDB_GAMES SET COLLECTION_ID = :collectionId WHERE GAME_ID = :gameId`, { collectionId, gameId }, { autoCommit: true });
            }
            // Parent Game
            if (details.parent_game) {
                await connection.execute(`UPDATE GAMEDB_GAMES SET PARENT_IGDB_ID = :parentId, PARENT_GAME_NAME = :parentName
           WHERE GAME_ID = :gameId`, {
                    parentId: details.parent_game.id,
                    parentName: details.parent_game.name,
                    gameId,
                }, { autoCommit: true });
            }
        }
        finally {
            await connection.close();
        }
    }
    static async ensurePlatform(igdbPlatform) {
        const existing = await Game.getPlatformByIgdbId(igdbPlatform.id);
        if (existing) {
            return existing;
        }
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            await connection.execute(`INSERT INTO GAMEDB_PLATFORMS (PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID)
         VALUES (:code, :name, :igdbId)`, {
                code: buildPlatformCode(igdbPlatform.name, igdbPlatform.id),
                name: igdbPlatform.name ?? `IGDB Platform ${igdbPlatform.id}`,
                igdbId: igdbPlatform.id,
            }, { autoCommit: true });
            return Game.getPlatformByIgdbId(igdbPlatform.id);
        }
        catch (err) {
            console.error(`Failed to insert platform ${igdbPlatform.name} (${igdbPlatform.id})`, err);
            return null;
        }
        finally {
            await connection.close();
        }
    }
    static async ensureRegion(igdbRegionId) {
        const existing = await Game.getRegionByIgdbId(igdbRegionId);
        if (existing) {
            return existing;
        }
        const regionConfig = IGDB_REGION_MAP[igdbRegionId];
        if (!regionConfig) {
            return null;
        }
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const insertRes = await connection.execute(`INSERT INTO GAMEDB_REGIONS (REGION_CODE, REGION_NAME, IGDB_REGION_ID)
         VALUES (:code, :name, :igdbId)
         RETURNING REGION_ID INTO :id`, {
                code: regionConfig.code,
                name: regionConfig.name,
                igdbId: igdbRegionId,
                id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
            }, { autoCommit: true });
            const regionId = insertRes.outBinds.id[0];
            return Game.getRegionById(regionId);
        }
        catch (err) {
            console.error(`Failed to insert region for IGDB region ${igdbRegionId}`, err);
            return null;
        }
        finally {
            await connection.close();
        }
    }
    // --- Getters for View ---
    static async getGameDevelopers(gameId) {
        return Game.getGameCompanies(gameId, 'Developer');
    }
    static async getGamePublishers(gameId) {
        return Game.getGameCompanies(gameId, 'Publisher');
    }
    static async getGameCompanies(gameId, role) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT c.NAME FROM GAMEDB_COMPANIES c 
         JOIN GAMEDB_GAME_COMPANIES gc ON c.COMPANY_ID = gc.COMPANY_ID 
         WHERE gc.GAME_ID = :gameId AND gc.ROLE = :role`, { gameId, role }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return result.rows.map(r => r.NAME);
        }
        finally {
            await connection.close();
        }
    }
    static async getGameGenres(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_GENRES', 'GAMEDB_GAME_GENRES', 'GENRE_ID');
    }
    static async getGameThemes(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_THEMES', 'GAMEDB_GAME_THEMES', 'THEME_ID');
    }
    static async getGameModes(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_GAME_MODES_DEF', 'GAMEDB_GAME_MODES', 'MODE_ID');
    }
    static async getGamePerspectives(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_PERSPECTIVES', 'GAMEDB_GAME_PERSPECTIVES', 'PERSPECTIVE_ID');
    }
    static async getGameEngines(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_ENGINES', 'GAMEDB_GAME_ENGINES', 'ENGINE_ID');
    }
    static async getGameFranchises(gameId) {
        return Game.getSimpleList(gameId, 'GAMEDB_FRANCHISES', 'GAMEDB_GAME_FRANCHISES', 'FRANCHISE_ID');
    }
    static async getGameSeries(gameId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT c.NAME FROM GAMEDB_COLLECTIONS c 
         JOIN GAMEDB_GAMES g ON c.COLLECTION_ID = g.COLLECTION_ID 
         WHERE g.GAME_ID = :gameId`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return result.rows[0]?.NAME || null;
        }
        finally {
            await connection.close();
        }
    }
    static async getSimpleList(gameId, defTable, mapTable, idCol) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT t.NAME FROM ${defTable} t 
         JOIN ${mapTable} m ON t.${idCol} = m.${idCol} 
         WHERE m.GAME_ID = :gameId`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return result.rows.map(r => r.NAME);
        }
        finally {
            await connection.close();
        }
    }
    static async addReleaseInfo(gameId, platformId, regionId, format, releaseDate, notes) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`INSERT INTO GAMEDB_RELEASES (GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES)
         VALUES (:gameId, :platformId, :regionId, :format, :releaseDate, :notes)
         RETURNING RELEASE_ID INTO :id`, {
                gameId,
                platformId,
                regionId,
                format,
                releaseDate: releaseDate || null,
                notes: notes || null,
                id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
            }, { autoCommit: true });
            const releaseId = result.outBinds.id[0];
            if (!releaseId) {
                throw new Error("Failed to retrieve RELEASE_ID after insert.");
            }
            // Fetch the newly created release to return a complete IRelease object
            const newRelease = await Game.getReleaseById(releaseId);
            if (!newRelease) {
                throw new Error("Failed to fetch newly created release.");
            }
            return newRelease;
        }
        finally {
            await connection.close();
        }
    }
    static async getReleaseById(id) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT RELEASE_ID, GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES
           FROM GAMEDB_RELEASES
          WHERE RELEASE_ID = :id`, { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapReleaseRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getGameReleases(gameId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT RELEASE_ID, GAME_ID, PLATFORM_ID, REGION_ID, FORMAT, RELEASE_DATE, NOTES
           FROM GAMEDB_RELEASES
          WHERE GAME_ID = :gameId
          ORDER BY RELEASE_DATE ASC`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (result.rows ?? []).map(mapReleaseRow);
        }
        finally {
            await connection.close();
        }
    }
    static async getAllPlatforms() {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID
           FROM GAMEDB_PLATFORMS
          ORDER BY PLATFORM_NAME ASC`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (result.rows ?? []).map(mapPlatformDefRow);
        }
        finally {
            await connection.close();
        }
    }
    static async getPlatformsByIgdbIds(igdbIds) {
        const uniqueIds = Array.from(new Set(igdbIds.filter((id) => Number.isInteger(id) && id > 0)));
        if (!uniqueIds.length) {
            return new Map();
        }
        const binds = {};
        const placeholders = [];
        uniqueIds.forEach((id, idx) => {
            const key = `id${idx}`;
            binds[key] = id;
            placeholders.push(`:${key}`);
        });
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID
           FROM GAMEDB_PLATFORMS
          WHERE IGDB_PLATFORM_ID IN (${placeholders.join(", ")})`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const map = new Map();
            (result.rows ?? []).forEach((row) => {
                const platform = mapPlatformDefRow(row);
                if (platform.igdbPlatformId) {
                    map.set(platform.igdbPlatformId, platform);
                }
            });
            return map;
        }
        finally {
            await connection.close();
        }
    }
    static async getPlatformByCode(code) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID
           FROM GAMEDB_PLATFORMS
          WHERE PLATFORM_CODE = :code`, { code }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapPlatformDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getPlatformById(id) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID
           FROM GAMEDB_PLATFORMS
          WHERE PLATFORM_ID = :id`, { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapPlatformDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async attachPlatformsToGames(games) {
        const gameIds = Array.from(new Set(games.map((game) => game.id).filter((id) => Number.isInteger(id) && id > 0)));
        if (!gameIds.length) {
            return games.map((game) => ({ ...game, platforms: [] }));
        }
        const binds = {};
        const placeholders = [];
        gameIds.forEach((id, idx) => {
            const key = `id${idx}`;
            binds[key] = id;
            placeholders.push(`:${key}`);
        });
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT gp.GAME_ID,
                gp.PLATFORM_ID,
                p.PLATFORM_CODE,
                p.PLATFORM_NAME,
                p.IGDB_PLATFORM_ID
           FROM GAMEDB_GAME_PLATFORMS gp
           LEFT JOIN GAMEDB_PLATFORMS p
             ON p.PLATFORM_ID = gp.PLATFORM_ID
          WHERE gp.GAME_ID IN (${placeholders.join(", ")})`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const gameToPlatforms = new Map();
            const missingPlatformIds = new Set();
            (result.rows ?? []).forEach((row) => {
                const gameId = Number(row.GAME_ID);
                const platformId = Number(row.PLATFORM_ID);
                if (!Number.isInteger(gameId) || !Number.isInteger(platformId)) {
                    return;
                }
                if (!row.PLATFORM_NAME || !row.PLATFORM_CODE) {
                    missingPlatformIds.add(platformId);
                    return;
                }
                const platform = {
                    id: platformId,
                    code: String(row.PLATFORM_CODE),
                    name: String(row.PLATFORM_NAME),
                    igdbPlatformId: row.IGDB_PLATFORM_ID ? Number(row.IGDB_PLATFORM_ID) : null,
                };
                if (!gameToPlatforms.has(gameId)) {
                    gameToPlatforms.set(gameId, []);
                }
                gameToPlatforms.get(gameId).push(platform);
            });
            if (missingPlatformIds.size) {
                console.warn(`Missing platform IDs in GAMEDB_PLATFORMS: ${Array.from(missingPlatformIds).join(", ")}`);
            }
            return games.map((game) => ({
                ...game,
                platforms: gameToPlatforms.get(game.id) ?? [],
            }));
        }
        finally {
            await connection.close();
        }
    }
    static async getPlatformByIgdbId(igdbId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME, IGDB_PLATFORM_ID
           FROM GAMEDB_PLATFORMS
          WHERE IGDB_PLATFORM_ID = :igdbId`, { igdbId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapPlatformDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getAllRegions() {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID
           FROM GAMEDB_REGIONS
          ORDER BY REGION_NAME ASC`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (result.rows ?? []).map(mapRegionDefRow);
        }
        finally {
            await connection.close();
        }
    }
    static async getRegionByCode(code) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID
           FROM GAMEDB_REGIONS
          WHERE REGION_CODE = :code`, { code }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapRegionDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getRegionById(id) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID
           FROM GAMEDB_REGIONS
          WHERE REGION_ID = :id`, { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapRegionDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async getRegionByIgdbId(igdbId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT REGION_ID, REGION_CODE, REGION_NAME, IGDB_REGION_ID
           FROM GAMEDB_REGIONS
          WHERE IGDB_REGION_ID = :igdbId`, { igdbId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const row = (result.rows ?? [])[0];
            return row ? mapRegionDefRow(row) : null;
        }
        finally {
            await connection.close();
        }
    }
    static async searchGames(query) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        const rawQuery = query.toLowerCase();
        const searchQuery = `%${rawQuery}%`;
        const normalizedQuery = `%${rawQuery.replace(/[^a-z0-9]/g, "")}%`;
        try {
            const result = await connection.execute(`SELECT GAME_ID, TITLE, DESCRIPTION, IGDB_ID, SLUG, TOTAL_RATING, IGDB_URL, CREATED_AT, UPDATED_AT
           FROM GAMEDB_GAMES
          WHERE LOWER(TITLE) LIKE :searchQuery
             OR REGEXP_REPLACE(LOWER(TITLE), '[^a-z0-9]', '') LIKE :normalizedQuery
          ORDER BY TITLE ASC`, { searchQuery, normalizedQuery }, {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: { DESCRIPTION: { type: oracledb.STRING } },
            });
            // Map rows, but exclude imageData to keep search results lightweight
            const games = (result.rows ?? []).map(row => ({
                id: Number(row.GAME_ID),
                title: String(row.TITLE),
                description: row.DESCRIPTION ? String(row.DESCRIPTION) : null,
                imageData: null, // Exclude image data for search results
                igdbId: row.IGDB_ID ? Number(row.IGDB_ID) : null,
                slug: row.SLUG ? String(row.SLUG) : null,
                totalRating: row.TOTAL_RATING ? Number(row.TOTAL_RATING) : null,
                igdbUrl: row.IGDB_URL ? String(row.IGDB_URL) : null,
                createdAt: row.CREATED_AT instanceof Date ? row.CREATED_AT : new Date(row.CREATED_AT),
                updatedAt: row.UPDATED_AT instanceof Date ? row.UPDATED_AT : new Date(row.UPDATED_AT),
            }));
            return await Game.attachPlatformsToGames(games);
        }
        finally {
            await connection.close();
        }
    }
    static async addGamePlatformsByIgdbIds(gameId, igdbPlatformIds) {
        if (!Number.isInteger(gameId) || gameId <= 0)
            return;
        const uniqueIds = Array.from(new Set(igdbPlatformIds.filter((id) => Number.isInteger(id) && id > 0)));
        if (!uniqueIds.length)
            return;
        const platformMap = await Game.getPlatformsByIgdbIds(uniqueIds);
        const missingIds = uniqueIds.filter((id) => !platformMap.has(id));
        if (missingIds.length) {
            console.warn(`Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingIds.join(", ")}`);
        }
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            for (const igdbId of uniqueIds) {
                const platform = platformMap.get(igdbId);
                if (!platform)
                    continue;
                await connection.execute(`MERGE INTO GAMEDB_GAME_PLATFORMS gp
           USING (SELECT :gameId AS GAME_ID, :platformId AS PLATFORM_ID FROM dual) src
           ON (gp.GAME_ID = src.GAME_ID AND gp.PLATFORM_ID = src.PLATFORM_ID)
           WHEN NOT MATCHED THEN
             INSERT (GAME_ID, PLATFORM_ID) VALUES (src.GAME_ID, src.PLATFORM_ID)`, { gameId, platformId: platform.id }, { autoCommit: false });
            }
            await connection.commit();
        }
        catch (err) {
            await connection.rollback();
            throw err;
        }
        finally {
            await connection.close();
        }
    }
    static async getGamesForAudit(missingImage, missingThread) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const whereClauses = [];
            if (missingImage) {
                whereClauses.push("IMAGE_DATA IS NULL");
            }
            if (missingThread) {
                // Checking for missing thread links requires looking at associations or Thread table logic?
                // The prompt says "check for missing images and thread links".
                // GAMEDB_GAMES doesn't store thread_id directly.
                // It's linked via GOTM_ENTRIES, NR_GOTM_ENTRIES, THREAD_GAME_LINKS, THREADS.
                // But for "audit", we probably want to know if there is *any* thread linked to this game.
                // A game is "missing thread" if no row exists in THREAD_GAME_LINKS and no row in THREADS for this GAME_ID.
                // Wait, looking at `getGameAssociations` and `getNowPlayingMembers` queries...
                // THREAD_GAME_LINKS seems to be the main join table for "generic" links.
                // THREADS table might also have GAMEDB_GAME_ID.
                // Let's assume a game has a thread if it appears in THREAD_GAME_LINKS or THREADS.
                whereClauses.push(`
          NOT EXISTS (SELECT 1 FROM THREAD_GAME_LINKS tgl WHERE tgl.GAMEDB_GAME_ID = g.GAME_ID)
          AND NOT EXISTS (SELECT 1 FROM THREADS th WHERE th.GAMEDB_GAME_ID = g.GAME_ID)
          AND NOT EXISTS (SELECT 1 FROM GOTM_ENTRIES ge WHERE ge.GAMEDB_GAME_ID = g.GAME_ID AND ge.THREAD_ID IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM NR_GOTM_ENTRIES nge WHERE nge.GAMEDB_GAME_ID = g.GAME_ID AND nge.THREAD_ID IS NOT NULL)
        `);
            }
            if (whereClauses.length === 0) {
                return [];
            }
            // If both are true, we want games that have missing image OR missing thread?
            // "check for missing images and thread links" -> usually implies Union or OR logic in an audit.
            // If I say "audit images", I get missing images.
            // If I say "audit threads", I get missing threads.
            // If I say "audit both", I probably want anything that is missing either.
            const whereClause = whereClauses.join(" OR ");
            const result = await connection.execute(`SELECT g.GAME_ID, g.TITLE, g.DESCRIPTION, g.IMAGE_DATA, g.IGDB_ID, g.SLUG, g.TOTAL_RATING, g.IGDB_URL, g.CREATED_AT, g.UPDATED_AT
           FROM GAMEDB_GAMES g
          WHERE ${whereClause}
          ORDER BY g.TITLE ASC`, [], {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: {
                    IMAGE_DATA: { type: oracledb.BUFFER },
                    DESCRIPTION: { type: oracledb.STRING },
                },
            });
            return (result.rows ?? []).map(mapGameRow);
        }
        finally {
            await connection.close();
        }
    }
    static async updateGameImage(gameId, imageData) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            await connection.execute(`UPDATE GAMEDB_GAMES SET IMAGE_DATA = :imageData, UPDATED_AT = SYSTIMESTAMP WHERE GAME_ID = :gameId`, { imageData, gameId }, { autoCommit: true });
        }
        finally {
            await connection.close();
        }
    }
    static async getGameAssociations(gameId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const gotmWinsResult = await connection.execute(`SELECT ROUND_NUMBER, THREAD_ID, REDDIT_URL, MONTH_YEAR
           FROM GOTM_ENTRIES
          WHERE GAMEDB_GAME_ID = :gameId
          ORDER BY ROUND_NUMBER`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const nrGotmWinsResult = await connection.execute(`SELECT ROUND_NUMBER, THREAD_ID, REDDIT_URL, MONTH_YEAR
           FROM NR_GOTM_ENTRIES
          WHERE GAMEDB_GAME_ID = :gameId
          ORDER BY ROUND_NUMBER`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const gotmNomsResult = await connection.execute(`SELECT n.ROUND_NUMBER,
                n.USER_ID,
                u.USERNAME,
                u.GLOBAL_NAME
           FROM GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const nrGotmNomsResult = await connection.execute(`SELECT n.ROUND_NUMBER,
                n.USER_ID,
                u.USERNAME,
                u.GLOBAL_NAME
           FROM NR_GOTM_NOMINATIONS n
           LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = n.USER_ID
          WHERE n.GAMEDB_GAME_ID = :gameId
          ORDER BY n.ROUND_NUMBER`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const gotmWins = (gotmWinsResult.rows ?? []).map((row) => ({
                round: Number(row.ROUND_NUMBER),
                threadId: row.THREAD_ID ?? null,
                redditUrl: row.REDDIT_URL ?? null,
                monthYear: String(row.MONTH_YEAR),
            })) ?? [];
            const nrGotmWins = (nrGotmWinsResult.rows ?? []).map((row) => ({
                round: Number(row.ROUND_NUMBER),
                threadId: row.THREAD_ID ?? null,
                redditUrl: row.REDDIT_URL ?? null,
                monthYear: String(row.MONTH_YEAR),
            })) ?? [];
            const gotmNominations = (gotmNomsResult.rows ?? []).map((row) => ({
                round: Number(row.ROUND_NUMBER),
                userId: String(row.USER_ID),
                username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
            })) ?? [];
            const nrGotmNominations = (nrGotmNomsResult.rows ?? []).map((row) => ({
                round: Number(row.ROUND_NUMBER),
                userId: String(row.USER_ID),
                username: String(row.GLOBAL_NAME || row.USERNAME || row.USER_ID),
            })) ?? [];
            return {
                gotmWins,
                nrGotmWins,
                gotmNominations,
                nrGotmNominations,
            };
        }
        finally {
            await connection.close();
        }
    }
    static async getNowPlayingMembers(gameId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const res = await connection.execute(`SELECT u.USER_ID,
                ru.USERNAME,
                ru.GLOBAL_NAME,
                COALESCE(
                  (SELECT MIN(tgl.THREAD_ID)
                     FROM THREAD_GAME_LINKS tgl
                    WHERE tgl.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID),
                  (SELECT MIN(th.THREAD_ID)
                     FROM THREADS th
                    WHERE th.GAMEDB_GAME_ID = u.GAMEDB_GAME_ID)
                ) AS THREAD_ID,
                u.ADDED_AT
           FROM USER_NOW_PLAYING u
           JOIN RPG_CLUB_USERS ru ON ru.USER_ID = u.USER_ID
          WHERE u.GAMEDB_GAME_ID = :gameId
          ORDER BY u.ADDED_AT DESC, u.ENTRY_ID DESC`, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (res.rows ?? []).map((row) => ({
                userId: String(row.USER_ID),
                username: row.USERNAME ?? null,
                globalName: row.GLOBAL_NAME ?? null,
                threadId: row.THREAD_ID ?? null,
                addedAt: row.ADDED_AT instanceof Date
                    ? row.ADDED_AT
                    : row.ADDED_AT
                        ? new Date(row.ADDED_AT)
                        : null,
            }));
        }
        finally {
            await connection.close();
        }
    }
    static async getGameCompletions(gameId) {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const res = await connection.execute(`
        SELECT c.USER_ID,
               u.USERNAME,
               u.GLOBAL_NAME,
               c.COMPLETION_TYPE,
               c.COMPLETED_AT,
               c.FINAL_PLAYTIME_HRS
          FROM USER_GAME_COMPLETIONS c
          LEFT JOIN RPG_CLUB_USERS u ON u.USER_ID = c.USER_ID
         WHERE c.GAMEDB_GAME_ID = :gameId
         ORDER BY c.COMPLETED_AT DESC NULLS LAST, c.CREATED_AT DESC, c.COMPLETION_ID DESC
        `, { gameId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return (res.rows ?? []).map((row) => ({
                userId: String(row.USER_ID),
                username: row.USERNAME ?? null,
                globalName: row.GLOBAL_NAME ?? null,
                completionType: String(row.COMPLETION_TYPE),
                completedAt: row.COMPLETED_AT instanceof Date
                    ? row.COMPLETED_AT
                    : row.COMPLETED_AT
                        ? new Date(row.COMPLETED_AT)
                        : null,
                finalPlaytimeHours: row.FINAL_PLAYTIME_HRS == null ? null : Number(row.FINAL_PLAYTIME_HRS),
            }));
        }
        finally {
            await connection.close();
        }
    }
}
