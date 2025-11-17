import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface NrGotmGame {
  title: string;
  threadId: string | null;
  redditUrl: string | null;
}

export interface NrGotmEntry {
  round: number;
  monthYear: string;
  gameOfTheMonth: NrGotmGame[];
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

let nrGotmData: NrGotmEntry[] = [];
let loadPromise: Promise<NrGotmEntry[]> | null = null;
let nrGotmLoaded = false;

async function loadFromDatabaseInternal(): Promise<NrGotmEntry[]> {
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
         FROM NR_GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = result.rows ?? [];
    const byRound = new Map<number, NrGotmEntry>();

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

      const game: NrGotmGame = {
        title: row.GAME_TITLE,
        threadId: row.THREAD_ID ?? null,
        redditUrl: row.REDDIT_URL ?? null,
      };

      entry.gameOfTheMonth.push(game);
    }

    const data = Array.from(byRound.values()).sort((a, b) => a.round - b.round);
    nrGotmData = data;
    nrGotmLoaded = true;
    return nrGotmData;
  } finally {
    await connection.close();
  }
}

export async function loadNrGotmFromDb(): Promise<void> {
  if (nrGotmLoaded) return;
  if (!loadPromise) {
    loadPromise = loadFromDatabaseInternal().catch((err) => {
      loadPromise = null;
      throw err;
    });
  }
  await loadPromise;
}

function ensureInitialized(): void {
  if (!nrGotmLoaded) {
    throw new Error("NR-GOTM data not initialized. Call loadNrGotmFromDb() during startup.");
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

export default class NrGotm {
  static all(): NrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.slice();
  }

  static getByRound(round: number): NrGotmEntry[] {
    ensureInitialized();
    return nrGotmData.filter((e) => e.round === round);
  }

  static getByYearMonth(year: number, month: number | string): NrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];

    const wantedLabel: string | null =
      typeof month === "number" ? monthNumberToName(month) : month?.trim() ?? null;

    if (!wantedLabel) return [];
    const wantedLower = wantedLabel.toLowerCase();

    return nrGotmData.filter((e) => {
      const y = parseYear(e.monthYear);
      if (y !== yearNum) return false;
      const labelLower = parseMonthLabel(e.monthYear).toLowerCase();
      return labelLower === wantedLower;
    });
  }

  static getByYear(year: number): NrGotmEntry[] {
    ensureInitialized();
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];
    return nrGotmData.filter((e) => parseYear(e.monthYear) === yearNum);
  }

  static searchByTitle(query: string): NrGotmEntry[] {
    ensureInitialized();
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    return nrGotmData.filter((e) =>
      e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q)),
    );
  }

  static addRound(round: number, monthYear: string, games: NrGotmGame[]): NrGotmEntry {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) {
      throw new Error("Invalid round number for new NR-GOTM round.");
    }
    if (nrGotmData.some((e) => e.round === r)) {
      throw new Error(`NR-GOTM round ${r} already exists.`);
    }
    const entry: NrGotmEntry = {
      round: r,
      monthYear,
      gameOfTheMonth: games.map((g) => ({
        title: g.title,
        threadId: g.threadId ?? null,
        redditUrl: g.redditUrl ?? null,
      })),
    };
    nrGotmData.push(entry);
    nrGotmData.sort((a, b) => a.round - b.round);
    return entry;
  }

  private static getRoundEntry(round: number): NrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const entry = nrGotmData.find((e) => e.round === r) ?? null;
    return entry ?? null;
  }

  private static resolveIndex(entry: NrGotmEntry, index?: number): number {
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
  ): NrGotmEntry | null {
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
  ): NrGotmEntry | null {
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
  ): NrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].redditUrl = redditUrl;
    return entry;
  }

  static updateVotingResultsByRound(
    round: number,
    messageId: string | null,
  ): NrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    entry.votingResultsMessageId = messageId;
    return entry;
  }

  static deleteRound(round: number): NrGotmEntry | null {
    ensureInitialized();
    const r = Number(round);
    if (!Number.isFinite(r)) return null;
    const index = nrGotmData.findIndex((e) => e.round === r);
    if (index === -1) return null;
    const [removed] = nrGotmData.splice(index, 1);
    return removed ?? null;
  }
}

export type NrGotmEditableField = "title" | "threadId" | "redditUrl";

export async function updateNrGotmGameFieldInDatabase(
  round: number,
  gameIndex: number,
  field: NrGotmEditableField,
  value: string | null,
): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const columnMap: Record<NrGotmEditableField, string> = {
      title: "GAME_TITLE",
      threadId: "THREAD_ID",
      redditUrl: "REDDIT_URL",
    };

    const columnName = columnMap[field];

    const result = await connection.execute<{
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    }>(
      `SELECT ROUND_NUMBER,
              GAME_INDEX
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round
        ORDER BY GAME_INDEX`,
      { round },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = (result.rows ?? []) as any[];

    if (!rows.length) {
      throw new Error(`No NR-GOTM database rows found for round ${round}.`);
    }

    if (!Number.isInteger(gameIndex) || gameIndex < 0 || gameIndex >= rows.length) {
      throw new Error(
        `Game index ${gameIndex} is out of range for NR-GOTM round ${round} (have ${rows.length} games).`,
      );
    }

    const targetRow = rows[gameIndex] as {
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    };

    const dbGameIndex = targetRow.GAME_INDEX;

    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE ROUND_NUMBER = :round
          AND GAME_INDEX = :gameIndex`,
      {
        round,
        gameIndex: dbGameIndex,
        value,
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateNrGotmVotingResultsInDatabase(
  round: number,
  messageId: string | null,
): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET VOTING_RESULTS_MESSAGE_ID = :value
        WHERE ROUND_NUMBER = :round`,
      { round, value: messageId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function insertNrGotmRoundInDatabase(
  round: number,
  monthYear: string,
  games: NrGotmGame[],
): Promise<void> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM insert.");
  }
  if (!games.length) {
    throw new Error("At least one game is required for an NR-GOTM round.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const existing = await connection.execute<{ CNT: number }>(
      `SELECT COUNT(*) AS CNT
         FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`,
      { round },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    const rows = (existing.rows ?? []) as any[];
    const count = rows.length ? Number((rows[0] as any).CNT) : 0;
    if (Number.isFinite(count) && count > 0) {
      throw new Error(`NR-GOTM round ${round} already exists in the database.`);
    }

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      await connection.execute(
        `INSERT INTO NR_GOTM_ENTRIES (
           ROUND_NUMBER,
           MONTH_YEAR,
           GAME_INDEX,
           GAME_TITLE,
           THREAD_ID,
           REDDIT_URL,
           VOTING_RESULTS_MESSAGE_ID
         ) VALUES (
           :round,
           :monthYear,
           :gameIndex,
           :title,
           :threadId,
           :redditUrl,
           NULL
         )`,
        {
          round,
          monthYear,
          gameIndex: i,
          title: g.title,
          threadId: g.threadId ?? null,
          redditUrl: g.redditUrl ?? null,
        },
        { autoCommit: true },
      );
    }
  } finally {
    await connection.close();
  }
}

export async function deleteNrGotmRoundFromDatabase(round: number): Promise<number> {
  if (!Number.isFinite(round) || round <= 0) {
    throw new Error("Invalid round number for NR-GOTM delete.");
  }

  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const result = await connection.execute(
      `DELETE FROM NR_GOTM_ENTRIES
        WHERE ROUND_NUMBER = :round`,
      { round },
      { autoCommit: true },
    );

    const rowsAffected = result.rowsAffected ?? 0;
    return rowsAffected;
  } finally {
    await connection.close();
  }
}

