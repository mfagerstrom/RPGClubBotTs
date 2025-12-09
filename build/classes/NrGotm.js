import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
import Game from "./Game.js";
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
let nrGotmData = [];
let loadPromise = null;
let nrGotmLoaded = false;
const nrGameCache = new Map();
async function getNrGameDetailsCached(gameId) {
    const cached = nrGameCache.get(gameId);
    if (cached)
        return cached;
    const game = await Game.getGameById(gameId);
    if (!game) {
        throw new Error(`GameDB game ${gameId} not found for NR-GOTM entry.`);
    }
    const payload = { title: game.title };
    nrGameCache.set(gameId, payload);
    return payload;
}
async function loadFromDatabaseInternal() {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`SELECT ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              THREAD_ID,
              REDDIT_URL,
              VOTING_RESULTS_MESSAGE_ID,
              GAMEDB_GAME_ID
         FROM NR_GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`, [], {
            outFormat: oracledb.OUT_FORMAT_OBJECT,
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
            const gamedbGameId = Number(row.GAMEDB_GAME_ID);
            if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
                throw new Error(`NR-GOTM round ${round} game ${row.GAME_INDEX} is missing GAMEDB_GAME_ID.`);
            }
            const gameDetails = await getNrGameDetailsCached(gamedbGameId);
            const game = {
                id: Number(row.NR_GOTM_ID),
                title: gameDetails.title,
                threadId: row.THREAD_ID ?? null,
                redditUrl: row.REDDIT_URL ?? null,
                gamedbGameId,
            };
            entry.gameOfTheMonth.push(game);
        }
        const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
        nrGotmData = data;
        nrGotmLoaded = true;
        return nrGotmData;
    }
    finally {
        await connection.close();
    }
}
export async function loadNrGotmFromDb() {
    if (nrGotmLoaded)
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
    if (!nrGotmLoaded) {
        throw new Error("NR-GOTM data not initialized. Call loadNrGotmFromDb() during startup.");
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
export default class NrGotm {
    static all() {
        ensureInitialized();
        return nrGotmData.slice();
    }
    static getByRound(round) {
        ensureInitialized();
        return nrGotmData.filter((e) => e.round === round);
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
        return nrGotmData.filter((e) => {
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
        return nrGotmData.filter((e) => parseYear(e.monthYear) === yearNum);
    }
    static searchByTitle(query) {
        ensureInitialized();
        if (!query?.trim())
            return [];
        const q = query.toLowerCase();
        return nrGotmData.filter((e) => e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)));
    }
    static addRound(round, monthYear, games) {
        ensureInitialized();
        const r = Number(round);
        if (!Number.isFinite(r)) {
            throw new Error("Invalid round number for new NR-GOTM round.");
        }
        if (nrGotmData.some((e) => e.round === r)) {
            throw new Error(`NR-GOTM round ${r} already exists.`);
        }
        const entry = {
            round: r,
            monthYear,
            gameOfTheMonth: games.map((g) => {
                if (!Number.isInteger(g.gamedbGameId) || g.gamedbGameId <= 0) {
                    throw new Error("GameDB id is required for NR-GOTM entries.");
                }
                return {
                    id: g.id ?? null,
                    title: g.title,
                    threadId: g.threadId ?? null,
                    redditUrl: g.redditUrl ?? null,
                    gamedbGameId: g.gamedbGameId,
                };
            }),
        };
        nrGotmData.push(entry);
        nrGotmData.sort((a, b) => a.round - b.round);
        return entry;
    }
    static getRoundEntry(round) {
        ensureInitialized();
        const r = Number(round);
        if (!Number.isFinite(r))
            return null;
        const entry = nrGotmData.find((e) => e.round === r) ?? null;
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
    static updateGamedbIdByRound(round, gamedbGameId, index) {
        const entry = this.getRoundEntry(round);
        if (!entry)
            return null;
        if (!Number.isInteger(gamedbGameId) || gamedbGameId <= 0) {
            throw new Error("GameDB id must be a positive integer.");
        }
        const i = this.resolveIndex(entry, index);
        entry.gameOfTheMonth[i].gamedbGameId = gamedbGameId;
        void getNrGameDetailsCached(gamedbGameId).then((meta) => {
            entry.gameOfTheMonth[i].title = meta.title;
            nrGameCache.set(gamedbGameId, meta);
        });
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
        const index = nrGotmData.findIndex((e) => e.round === r);
        if (index === -1)
            return null;
        const [removed] = nrGotmData.splice(index, 1);
        return removed ?? null;
    }
}
export async function updateNrGotmGameFieldInDatabase(opts) {
    ensureInitialized();
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const columnMap = {
            threadId: "THREAD_ID",
            redditUrl: "REDDIT_URL",
            gamedbGameId: "GAMEDB_GAME_ID",
        };
        const columnName = columnMap[opts.field];
        // Prefer rowId if provided
        let dbValue = opts.value;
        if (opts.field === "gamedbGameId") {
            const newId = Number(opts.value);
            if (!Number.isInteger(newId) || newId <= 0) {
                throw new Error("GameDB id must be a positive integer.");
            }
            const exists = await getNrGameDetailsCached(newId);
            nrGameCache.set(newId, exists);
            dbValue = newId;
        }
        if (opts.rowId) {
            await connection.execute(`UPDATE NR_GOTM_ENTRIES
            SET ${columnName} = :value
          WHERE NR_GOTM_ID = :rowId`, {
                rowId: opts.rowId,
                value: dbValue,
            }, { autoCommit: true });
            const entryWithRow = nrGotmData.find((e) => e.gameOfTheMonth.some((g) => Number(g.id) === Number(opts.rowId)));
            if (entryWithRow) {
                for (const g of entryWithRow.gameOfTheMonth) {
                    if (Number(g.id) === Number(opts.rowId)) {
                        if (opts.field === "gamedbGameId") {
                            const newId = dbValue;
                            g.gamedbGameId = newId;
                            const meta = await getNrGameDetailsCached(newId);
                            g.title = meta.title;
                        }
                        else if (opts.field === "threadId") {
                            g.threadId = opts.value;
                        }
                        else if (opts.field === "redditUrl") {
                            g.redditUrl = opts.value;
                        }
                    }
                }
            }
            return;
        }
        const round = opts.round;
        const gameIndex = opts.gameIndex;
        if (!Number.isInteger(round)) {
            throw new Error("round is required when rowId is not provided.");
        }
        if (!Number.isInteger(gameIndex)) {
            throw new Error("gameIndex is required when rowId is not provided.");
        }
        const result = await connection.execute(`SELECT NR_GOTM_ID,
              ROUND_NUMBER,
              GAME_INDEX
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (result.rows ?? []);
        if (!rows.length) {
            throw new Error(`No NR-GOTM database rows found for round ${round}.`);
        }
        const gi = Number(gameIndex);
        if (!Number.isInteger(gi) || gi < 0 || gi >= rows.length) {
            throw new Error(`Game index ${gameIndex} is out of range for NR-GOTM round ${round} (have ${rows.length} games).`);
        }
        const targetRow = rows[gi];
        const rowId = targetRow.NR_GOTM_ID;
        await connection.execute(`UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE NR_GOTM_ID = :rowId`, {
            rowId,
            value: dbValue,
        }, { autoCommit: true });
        const entry = nrGotmData.find((e) => e.round === round);
        if (entry && entry.gameOfTheMonth[gi]) {
            const target = entry.gameOfTheMonth[gi];
            if (opts.field === "gamedbGameId") {
                const newId = dbValue;
                target.gamedbGameId = newId;
                const meta = await getNrGameDetailsCached(newId);
                target.title = meta.title;
            }
            else if (opts.field === "threadId") {
                target.threadId = opts.value;
            }
            else if (opts.field === "redditUrl") {
                target.redditUrl = opts.value;
            }
        }
    }
    finally {
        await connection.close();
    }
}
export async function updateNrGotmVotingResultsInDatabase(round, messageId) {
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        await connection.execute(`UPDATE NR_GOTM_ENTRIES
          SET VOTING_RESULTS_MESSAGE_ID = :value
        WHERE ROUND_NUMBER = :round`, { round, value: messageId }, { autoCommit: true });
    }
    finally {
        await connection.close();
    }
}
export async function insertNrGotmRoundInDatabase(round, monthYear, games) {
    if (!Number.isFinite(round) || round <= 0) {
        throw new Error("Invalid round number for NR-GOTM insert.");
    }
    if (!games.length) {
        throw new Error("At least one game is required for an NR-GOTM round.");
    }
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const existing = await connection.execute(`SELECT COUNT(*) AS CNT
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`, { round }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const rows = (existing.rows ?? []);
        const count = rows.length ? Number(rows[0].CNT) : 0;
        if (Number.isFinite(count) && count > 0) {
            throw new Error(`NR-GOTM round ${round} already exists in the database.`);
        }
        const insertedIds = [];
        for (let i = 0; i < games.length; i++) {
            const g = games[i];
            if (!Number.isInteger(g.gamedbGameId) || g.gamedbGameId <= 0) {
                throw new Error(`GameDB id is required for NR-GOTM round ${round}, game ${i + 1}.`);
            }
            const meta = await getNrGameDetailsCached(g.gamedbGameId);
            const result = await connection.execute(`INSERT INTO NR_GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           THREAD_ID,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID,
           GAMEDB_GAME_ID
         ) VALUES (
           :round,
           :monthYear,
           :gameIndex,
           :threadId,
           :redditUrl,
           NULL,
           :gamedbGameId
         )
         RETURNING NR_GOTM_ID INTO :outId`, {
                round,
                monthYear,
                gameIndex: i,
                threadId: g.threadId ?? null,
                redditUrl: g.redditUrl ?? null,
                gamedbGameId: g.gamedbGameId,
                outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            }, { autoCommit: true });
            const outIdArr = result.outBinds?.outId;
            const newId = Array.isArray(outIdArr) ? outIdArr[0] : outIdArr;
            if (newId !== undefined && newId !== null) {
                insertedIds.push(Number(newId));
            }
            games[i].title = meta.title;
        }
        return insertedIds;
    }
    finally {
        await connection.close();
    }
}
export async function deleteNrGotmRoundFromDatabase(round) {
    if (!Number.isFinite(round) || round <= 0) {
        throw new Error("Invalid round number for NR-GOTM delete.");
    }
    const pool = getOraclePool();
    const connection = await pool.getConnection();
    try {
        const result = await connection.execute(`DELETE FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`, { round }, { autoCommit: true });
        const rowsAffected = result.rowsAffected ?? 0;
        return rowsAffected;
    }
    finally {
        await connection.close();
    }
}
