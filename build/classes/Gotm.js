import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
const MONTHS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
let gotmData = [];
let loadPromise = null;
let gotmLoaded = false;
async function loadFromDatabaseInternal() {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              VOTING_RESULTS_MESSAGE_ID,
              IMAGE_BLOB,
              IMAGE_MIME_TYPE
         FROM GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
            fetchInfo: {
                IMAGE_BLOB: { type: oracledb.BUFFER },
            },
        });
        const rows = result.rows ?? [];
        const byRound = new Map();
        for (const anyRow of rows) {
            const row = anyRow;
            const round = Number(row.ROUND_NUMBER);
            if (!Number.isFinite(round))
                continue;
            const monthYear = row.MONTH_YEAR;
            const votingId = row.VOTING_RESULTS_MESSAGE_ID ?? null;
            let entry = byRound.get(round);
            if (!entry) {
                entry = {
                    round,
                    monthYear,
                    gameOfTheMonth: [],
                };
                if (votingId) {
                    entry.votingResultsMessageId = votingId;
                }
                byRound.set(round, entry);
            }
            else if (!entry.votingResultsMessageId && votingId) {
                entry.votingResultsMessageId = votingId;
            }
            const game = {
                title: row.GAME_TITLE,
                threadId: row.THREAD_ID ?? null,
                redditUrl: row.REDDIT_URL ?? null,
                imageBlob: row.IMAGE_BLOB ?? null,
                imageMimeType: row.IMAGE_MIME_TYPE ?? null,
            };
            entry.gameOfTheMonth.push(game);
        }
        const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
        gotmData = data;
        gotmLoaded = true;
        return gotmData;
    }
    finally {
        await connection.close();
    }
}
export async function loadGotmFromDb() {
    if (gotmLoaded)
        return;
    if (!loadPromise) {
        loadPromise = loadFromDatabaseInternal().catch((err) => {
            loadPromise = null;
            throw err;
        });
    }
    await loadPromise;
}
function ensureInitialized() {
    if (!gotmLoaded) {
        throw new Error("GOTM data not initialized. Call loadGotmFromDb() during startup.");
    }
}
function parseYear(value) {
    const m = value.match(/(\d{4})\s*$/);
    return m ? Number(m[1]) : null;
}
function parseMonthLabel(value) {
    const label = value.replace(/\s*\d{4}\s*$/, "").trim();
    return label;
}
function monthNumberToName(month) {
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return null;
    return MONTHS[month - 1];
}
export default class Gotm {
    static all() {
        ensureInitialized();
        return gotmData.slice();
    }
    static getByRound(round) {
        ensureInitialized();
        return gotmData.filter((e) => e.round === round);
    }
    static getByYearMonth(year, month) {
        ensureInitialized();
        const yearNum = Number(year);
        if (!Number.isFinite(yearNum))
            return [];
        const wantedLabel = typeof month === "number" ? monthNumberToName(month) : month?.trim() ?? null;
        if (!wantedLabel)
            return [];
        const wantedLower = wantedLabel.toLowerCase();
        return gotmData.filter((e) => {
            const y = parseYear(e.monthYear);
            if (y !== yearNum)
                return false;
            const labelLower = parseMonthLabel(e.monthYear).toLowerCase();
            return labelLower === wantedLower;
        });
    }
    static getByYear(year) {
        ensureInitialized();
        const yearNum = Number(year);
        if (!Number.isFinite(yearNum))
            return [];
        return gotmData.filter((e) => parseYear(e.monthYear) === yearNum);
    }
    static searchByTitle(query) {
        ensureInitialized();
        if (!query?.trim())
            return [];
        const q = query.toLowerCase();
        return gotmData.filter((e) => e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)));
    }
    static addRound(round, monthYear, games) {
        ensureInitialized();
        const r = Number(round);
        if (!Number.isFinite(r)) {
            throw new Error("Invalid round number for new GOTM round.");
        }
        if (gotmData.some((e) => e.round === r)) {
            throw new Error(`GOTM round ${r} already exists.`);
        }
        const entry = {
            round: r,
            monthYear,
            gameOfTheMonth: games.map((g) => ({
                title: g.title,
                threadId: g.threadId ?? null,
                redditUrl: g.redditUrl ?? null,
                imageBlob: g.imageBlob ?? null,
                imageMimeType: g.imageMimeType ?? null,
            })),
        };
        gotmData.push(entry);
        gotmData.sort((a, b) => a.round - b.round);
        return entry;
    }
    static getRoundEntry(round) {
        ensureInitialized();
        const r = Number(round);
        if (!Number.isFinite(r))
            return null;
        const entry = gotmData.find((e) => e.round === r) ?? null;
        return entry ?? null;
    }
    static resolveIndex(entry, index) {
        const arrLen = entry.gameOfTheMonth.length;
        if (arrLen === 0)
            throw new Error(`Round ${entry.round} has no games.`);
        if (arrLen === 1)
            return 0;
        if (index === undefined || index === null) {
            throw new Error(`Round ${entry.round} has ${arrLen} games; provide an index (0-${arrLen - 1}).`);
        }
        if (!Number.isInteger(index) || index < 0 || index >= arrLen) {
            throw new Error(`Index ${index} out of bounds for round ${entry.round}.`);
        }
        return index;
    }
    static updateTitleByRound(round, newTitle, index) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        const i = this.resolveIndex(entry, index);
        entry.gameOfTheMonth[i].title = newTitle;
        return entry;
    }
    static updateThreadIdByRound(round, threadId, index) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        const i = this.resolveIndex(entry, index);
        entry.gameOfTheMonth[i].threadId = threadId === null ? null : String(threadId);
        return entry;
    }
    static updateRedditUrlByRound(round, redditUrl, index) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        const i = this.resolveIndex(entry, index);
        entry.gameOfTheMonth[i].redditUrl = redditUrl;
        return entry;
    }
    static updateImageByRound(round, imageBlob, imageMimeType, index) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        const i = this.resolveIndex(entry, index);
        entry.gameOfTheMonth[i].imageBlob = imageBlob;
        entry.gameOfTheMonth[i].imageMimeType = imageMimeType;
        return entry;
    }
    static updateVotingResultsByRound(round, messageId) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        entry.votingResultsMessageId = messageId;
        return entry;
    }
    static deleteRound(round) {
        ensureInitialized();
        const r = Number(round);
        if (!Number.isFinite(r))
            return null;
        const index = gotmData.findIndex((e) => e.round === r);
        if (index === -1)
            return null;
        const [removed] = gotmData.splice(index, 1);
        return removed ?? null;
    }
}
export async function updateGotmGameImageInDatabase(round, gameIndex, imageBlob, imageMimeType) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT ROUND_NUMBER,
              GAME_INDEX
         FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows ?? []);
        if (!rows.length) {
            throw new Error(`No GOTM database rows found for round ${round}.`);
        }
        if (!Number.isInteger(gameIndex) || gameIndex < 0 || gameIndex >= rows.length) {
            throw new Error(`Game index ${gameIndex} is out of range for round ${round} (have ${rows.length} games).`);
        }
        const targetRow = rows[gameIndex];
        const dbGameIndex = targetRow.GAME_INDEX;
        await connection.execute(`UPDATE GOTM_ENTRIES
          SET IMAGE_BLOB = :imageBlob,
              IMAGE_MIME_TYPE = :imageMimeType
        WHERE ROUND_NUMBER = :round
          AND GAME_INDEX = :gameIndex`, {
            round,
            gameIndex: dbGameIndex,
            imageBlob,
            imageMimeType,
        }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function updateGotmGameFieldInDatabase(round, gameIndex, field, value) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const columnMap = {
            title: "GAME_TITLE",
            threadId: "THREAD_ID",
            redditUrl: "REDDIT_URL",
        };
        const columnName = columnMap[field];
        const result = await connection.execute(`SELECT ROUND_NUMBER,
              GAME_INDEX
         FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows ?? []);
        if (!rows.length) {
            throw new Error(`No GOTM database rows found for round ${round}.`);
        }
        if (!Number.isInteger(gameIndex) || gameIndex < 0 || gameIndex >= rows.length) {
            throw new Error(`Game index ${gameIndex} is out of range for round ${round} (have ${rows.length} games).`);
        }
        const targetRow = rows[gameIndex];
        const dbGameIndex = targetRow.GAME_INDEX;
        await connection.execute(`UPDATE GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE ROUND_NUMBER = :round
          AND GAME_INDEX = :gameIndex`, {
            round,
            gameIndex: dbGameIndex,
            value,
        }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function updateGotmVotingResultsInDatabase(round, messageId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`UPDATE GOTM_ENTRIES
          SET VOTING_RESULTS_MESSAGE_ID = :value
        WHERE ROUND_NUMBER = :round`, { round, value: messageId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function insertGotmRoundInDatabase(round, monthYear, games) {
    if (!Number.isFinite(round) || round <= 0) {
        throw new Error("Invalid round number for GOTM insert.");
    }
    if (!games.length) {
        throw new Error("At least one game is required for a GOTM round.");
    }
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        // Optional safety check to avoid duplicate rounds in the database
        const existing = await connection.execute(`SELECT COUNT(*) AS CNT
         FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (existing.rows ?? []);
        const count = rows.length ? Number(rows[0].CNT) : 0;
        if (Number.isFinite(count) && count > 0) {
            throw new Error(`GOTM round ${round} already exists in the database.`);
        }
        for (let i = 0; i < games.length; i++) {
            const g = games[i];
            await connection.execute(`INSERT INTO GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           GAME_TITLE,
           THREAD_ID,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID,
           IMAGE_BLOB,
           IMAGE_MIME_TYPE
         ) VALUES (
           :round,
           :monthYear,
           :gameIndex,
           :title,
           :threadId,
           :redditUrl,
           NULL,
           :imageBlob,
           :imageMimeType
         )`, {
                round,
                monthYear,
                gameIndex: i,
                title: g.title,
                threadId: g.threadId ?? null,
                redditUrl: g.redditUrl ?? null,
                imageBlob: g.imageBlob ?? null,
                imageMimeType: g.imageMimeType ?? null,
            }, { autoCommit: true });
        }
    }
    finally {
        await connection.close();
    }
}
export async function deleteGotmRoundFromDatabase(round) {
    if (!Number.isFinite(round) || round <= 0) {
        throw new Error("Invalid round number for GOTM delete.");
    }
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`DELETE FROM GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`, { round }, { autoCommit: true });
        const rowsAffected = result.rowsAffected ?? 0;
        return rowsAffected;
    }
    finally {
        await connection.close();
    }
}
