import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface GotmGame {
  title: string;
  threadId: string | null;
  redditUrl: string | null;
}

export interface GotmEntry {
  round: number;
  monthYear: string;
  gameOfTheMonth: GotmGame[];
  votingResultsMessageId?: string | null;
}

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
] as const;

let gotmData: GotmEntry[] = [];
let loadPromise: Promise<GotmEntry[]> | null = null;
let gotmLoaded = false;

async function loadFromDatabaseInternal(): Promise<GotmEntry[]> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute<{
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      GAME_TITLE: string;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      VOTING_RESULTS_MESSAGE_ID: string | null;
    }>(
      `SELECT ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              VOTING_RESULTS_MESSAGE_ID
         FROM GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = result.rows ?? [];
    const byRound = new Map<number, GotmEntry>();

    for (const anyRow of rows as any[]) {
      const row = anyRow as {
        ROUND_NUMBER: number;
        MONTH_YEAR: string;
        GAME_INDEX: number;
        GAME_TITLE: string;
        THREAD_ID: string | null;
        REDDIT_URL: string | null;
        VOTING_RESULTS_MESSAGE_ID: string | null;
      };

      const round = Number(row.ROUND_NUMBER);
      if (!Number.isFinite(round)) continue;

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
      } else if (!entry.votingResultsMessageId && votingId) {
        entry.votingResultsMessageId = votingId;
      }

      const game: GotmGame = {
        title: row.GAME_TITLE,
        threadId: row.THREAD_ID ?? null,
        redditUrl: row.REDDIT_URL ?? null,
      };

      entry.gameOfTheMonth.push(game);
    }

    const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
    gotmData = data;
    gotmLoaded = true;
    return gotmData;
  } finally {
    await connection.close();
  }
}

export async function loadGotmFromDb(): Promise<void> {
  if (gotmLoaded) return;
  if (!loadPromise) {
    loadPromise = loadFromDatabaseInternal().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

function ensureInitialized(): void {
  if (!gotmLoaded) {
    throw new Error("GOTM data not initialized. Call loadGotmFromDb() during startup.");
  }
}

function parseYear(value: string): number | null {
  const m = value.match(/(\d{4})\s*$/);
  return m ? Number(m[1]) : null;
}

function parseMonthLabel(value: string): string {
  const label = value.replace(/\s*\d{4}\s*$/, "").trim();
  return label;
}

function monthNumberToName(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return MONTHS[month - 1];
}

export default class Gotm {
  static all(): GotmEntry[] {
    ensureInitialized();
    return gotmData.slice();
  }

  static getByRound(round: number): GotmEntry[] {
    ensureInitialized();
    return gotmData.filter((e) => e.round === round);
  }

  static getByYearMonth(year: number, month: number | string): GotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];

    const wantedLabel: string | null =
      typeof month === "number" ? monthNumberToName(month) : month?.trim() ?? null;

    if (!wantedLabel) return [];
    const wantedLower = wantedLabel.toLowerCase();

    return gotmData.filter((e) => {
      const y = parseYear(e.monthYear);
      if (y !== yearNum) return false;
      const labelLower = parseMonthLabel(e.monthYear).toLowerCase();
      return labelLower === wantedLower;
    });
  }

  static getByYear(year: number): GotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];
    return gotmData.filter((e) => parseYear(e.monthYear) === yearNum);
  }

  static searchByTitle(query: string): GotmEntry[] {
    ensureInitialized();
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    return gotmData.filter((e) =>
      e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)),
    );
  }

  private static getRoundEntry(round: number): GotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const entry = gotmData.find((e) => e.round === r) ?? null;
    return entry ?? null;
  }

  private static resolveIndex(entry: GotmEntry, index?: number): number {
    const arrLen = entry.gameOfTheMonth.length;
    if (arrLen === 0) throw new Error(`Round ${entry.round} has no games.`);
    if (arrLen === 1) return 0;
    if (index === undefined || index === null) {
      throw new Error(
        `Round ${entry.round} has ${arrLen} games; provide an index (0-${arrLen - 1}).`,
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= arrLen) {
      throw new Error(`Index ${index} out of bounds for round ${entry.round}.`);
    }
    return index;
  }

  static updateTitleByRound(
    round: number,
    newTitle: string,
    index?: number,
  ): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].title = newTitle;
    return entry;
  }

  static updateThreadIdByRound(
    round: number,
    threadId: string | null,
    index?: number,
  ): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].threadId = threadId === null ? null : String(threadId);
    return entry;
  }

  static updateRedditUrlByRound(
    round: number,
    redditUrl: string | null,
    index?: number,
  ): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].redditUrl = redditUrl;
    return entry;
  }
}
