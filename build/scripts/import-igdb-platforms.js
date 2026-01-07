import "dotenv/config";
import oracledb from "oracledb";
import { initOraclePool, getOraclePool } from "../db/oracleClient.js";
import { igdbService } from "../services/IgdbService.js";
const DEFAULT_LIMIT = 500;
const RATE_LIMIT_DELAY_MS = 300;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeCode = (input) => input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const buildFallbackCode = (name, igdbId) => {
    const platformName = name || `IGDB Platform ${igdbId}`;
    const sanitized = normalizeCode(platformName);
    const base = sanitized.slice(0, 12) || "PLATFORM";
    const codeWithId = `${base}${igdbId}`;
    return codeWithId.length > 20 ? codeWithId.slice(0, 20) : codeWithId;
};
const derivePlatformCode = (platform) => {
    const raw = platform.abbreviation || platform.slug || platform.name;
    const sanitized = normalizeCode(raw);
    if (!sanitized) {
        const fallback = `PLAT${platform.id}`;
        return fallback.length > 20 ? fallback.slice(0, 20) : fallback;
    }
    return sanitized.length > 20 ? sanitized.slice(0, 20) : sanitized;
};
const normalizeOptional = (value) => {
    if (!value)
        return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
};
const normalizeChecksum = (value) => normalizeOptional(value);
const normalizeUpdatedAt = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return Math.floor(value);
};
const validatePlatform = (platform) => {
    if (!platform || typeof platform.id !== "number" || !Number.isFinite(platform.id)) {
        return "Missing or invalid id";
    }
    if (!platform.name || !platform.name.trim()) {
        return "Missing name";
    }
    return null;
};
const codeConflicts = async (connection, code, igdbId) => {
    const result = await connection.execute(`SELECT PLATFORM_ID
       FROM GAMEDB_PLATFORMS
      WHERE PLATFORM_CODE = :code
        AND (IGDB_PLATFORM_ID IS NULL OR IGDB_PLATFORM_ID != :igdbId)`, { code, igdbId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return Boolean((result.rows ?? [])[0]);
};
const resolvePlatformCode = async (connection, platform) => {
    const preferred = derivePlatformCode(platform);
    if (!(await codeConflicts(connection, preferred, platform.id))) {
        return preferred;
    }
    const fallback = buildFallbackCode(platform.name, platform.id);
    if (!(await codeConflicts(connection, fallback, platform.id))) {
        return fallback;
    }
    const lastResort = `PLAT${platform.id}`;
    return lastResort.length > 20 ? lastResort.slice(0, 20) : lastResort;
};
const upsertPlatform = async (connection, platform, mode) => {
    const existingResult = await connection.execute(`SELECT PLATFORM_ID, PLATFORM_CODE, PLATFORM_NAME,
            PLATFORM_ABBREVIATION, PLATFORM_SLUG, PLATFORM_CHECKSUM, IGDB_UPDATED_AT,
            IGDB_PLATFORM_ID
       FROM GAMEDB_PLATFORMS
      WHERE IGDB_PLATFORM_ID = :igdbId`, { igdbId: platform.id }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const existingRow = (existingResult.rows ?? [])[0];
    const desiredName = platform.name.trim();
    const desiredCode = await resolvePlatformCode(connection, platform);
    const desiredAbbrev = normalizeOptional(platform.abbreviation);
    const desiredSlug = normalizeOptional(platform.slug);
    const desiredChecksum = normalizeChecksum(platform.checksum);
    const desiredUpdatedAt = normalizeUpdatedAt(platform.updated_at);
    if (!existingRow) {
        if (mode === "write") {
            await connection.execute(`INSERT INTO GAMEDB_PLATFORMS (
           PLATFORM_CODE,
           PLATFORM_NAME,
           PLATFORM_ABBREVIATION,
           PLATFORM_SLUG,
           PLATFORM_CHECKSUM,
           IGDB_UPDATED_AT,
           IGDB_PLATFORM_ID
         )
         VALUES (
           :code,
           :name,
           :abbreviation,
           :slug,
           :checksum,
           :updatedAt,
           :igdbId
         )`, {
                code: desiredCode,
                name: desiredName,
                abbreviation: desiredAbbrev,
                slug: desiredSlug,
                checksum: desiredChecksum,
                updatedAt: desiredUpdatedAt,
                igdbId: platform.id,
            }, { autoCommit: false });
        }
        return "inserted";
    }
    const currentName = String(existingRow.PLATFORM_NAME);
    const currentAbbrev = existingRow.PLATFORM_ABBREVIATION !== null
        ? String(existingRow.PLATFORM_ABBREVIATION)
        : null;
    const currentSlug = existingRow.PLATFORM_SLUG !== null
        ? String(existingRow.PLATFORM_SLUG)
        : null;
    const currentChecksum = existingRow.PLATFORM_CHECKSUM !== null
        ? String(existingRow.PLATFORM_CHECKSUM)
        : null;
    const currentUpdatedAt = existingRow.IGDB_UPDATED_AT !== null
        ? Number(existingRow.IGDB_UPDATED_AT)
        : null;
    const needsUpdate = currentName !== desiredName ||
        currentAbbrev !== desiredAbbrev ||
        currentSlug !== desiredSlug ||
        currentChecksum !== desiredChecksum ||
        currentUpdatedAt !== desiredUpdatedAt;
    if (!needsUpdate) {
        return "unchanged";
    }
    if (mode === "write") {
        await connection.execute(`UPDATE GAMEDB_PLATFORMS
          SET PLATFORM_NAME = :name,
              PLATFORM_ABBREVIATION = :abbreviation,
              PLATFORM_SLUG = :slug,
              PLATFORM_CHECKSUM = :checksum,
              IGDB_UPDATED_AT = :updatedAt
        WHERE PLATFORM_ID = :platformId`, {
            name: desiredName,
            abbreviation: desiredAbbrev,
            slug: desiredSlug,
            checksum: desiredChecksum,
            updatedAt: desiredUpdatedAt,
            platformId: existingRow.PLATFORM_ID,
        }, { autoCommit: false });
    }
    return "updated";
};
const main = async () => {
    const args = process.argv.slice(2);
    const mode = args.includes("--dry-run") ? "dry-run" : "write";
    await initOraclePool();
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    let offset = 0;
    let page = 1;
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSeen = 0;
    let totalSkipped = 0;
    try {
        while (true) {
            const platforms = await igdbService.getPlatformsPage(DEFAULT_LIMIT, offset);
            const pageCount = platforms.length;
            totalSeen += pageCount;
            let pageInserted = 0;
            let pageUpdated = 0;
            let pageSkipped = 0;
            try {
                for (const platform of platforms) {
                    const invalidReason = validatePlatform(platform);
                    if (invalidReason) {
                        console.warn(`Skipping platform with invalid data (id: ${String(platform?.id)}): ${invalidReason}`);
                        pageSkipped += 1;
                        continue;
                    }
                    const result = await upsertPlatform(connection, platform, mode);
                    if (result === "inserted")
                        pageInserted += 1;
                    if (result === "updated")
                        pageUpdated += 1;
                }
                if (mode === "write") {
                    await connection.commit();
                }
            }
            catch (err) {
                if (mode === "write") {
                    await connection.rollback();
                }
                throw err;
            }
            totalInserted += pageInserted;
            totalUpdated += pageUpdated;
            totalSkipped += pageSkipped;
            console.log(`Page ${page} (offset ${offset}) - fetched ${pageCount}, ` +
                `inserted ${pageInserted}, updated ${pageUpdated}, skipped ${pageSkipped}` +
                (mode === "dry-run" ? " [dry-run]" : ""));
            if (pageCount < DEFAULT_LIMIT) {
                break;
            }
            offset += DEFAULT_LIMIT;
            page += 1;
            await sleep(RATE_LIMIT_DELAY_MS);
        }
        console.log(`Done. Total fetched ${totalSeen}, inserted ${totalInserted}, ` +
            `updated ${totalUpdated}, skipped ${totalSkipped}` +
            (mode === "dry-run" ? " [dry-run]." : "."));
    }
    finally {
        await connection.close();
        await pool.close(0);
    }
};
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Import failed:", message);
    process.exitCode = 1;
});
