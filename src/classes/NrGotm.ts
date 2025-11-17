import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

export interface NrGotmGame {
  id?: number | null;
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  imageBlob?: Buffer | null;
  imageMimeType?: string | null;
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
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      MONTH_YEAR: string;
      GAME_INDEX: number;
      GAME_TITLE: string;
      THREAD_ID: string | null;
      REDDIT_URL: string | null;
      VOTING_RESULTS_MESSAGE_ID: string | null;
      IMAGE_BLOB: Buffer | null;
      IMAGE_MIME_TYPE: string | null;
    }>(
      `SELECT ROUND_NUMBER,
              MONTH_YEAR,
              GAME_INDEX,
              GAME_TITLE,
              THREAD_ID,
              REDDIT_URL,
              VOTING_RESULTS_MESSAGE_ID,
              IMAGE_BLOB,
              IMAGE_MIME_TYPE
         FROM NR_GOTM_ENTRIES
        ORDER BY ROUND_NUMBER, GAME_INDEX`,
      [],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        fetchInfo: {
          IMAGE_BLOB: { type: oracledb.BUFFER },
        },
      },
    );

    const rows = result.rows ?? [];
    const byRound = new Map<number, NrGotmEntry>();

    for (const anyRow of rows as any[]) {
      const row = anyRow as {
        NR_GOTM_ID: number;
        ROUND_NUMBER: number;
        MONTH_YEAR: string;
        GAME_INDEX: number;
        GAME_TITLE: string;
        THREAD_ID: string | null;
        REDDIT_URL: string | null;
        VOTING_RESULTS_MESSAGE_ID: string | null;
        IMAGE_BLOB: Buffer | null;
        IMAGE_MIME_TYPE: string | null;
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
        id: Number(row.NR_GOTM_ID),
        title: row.GAME_TITLE,
        threadId: row.THREAD_ID ?? null,
        redditUrl: row.REDDIT_URL ?? null,
        imageBlob: row.IMAGE_BLOB ?? null,
        imageMimeType: row.IMAGE_MIME_TYPE ?? null,
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
        id: g.id ?? null,
        title: g.title,
        threadId: g.threadId ?? null,
        redditUrl: g.redditUrl ?? null,
        imageBlob: g.imageBlob ?? null,
        imageMimeType: g.imageMimeType ?? null,
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

  static updateImageByRound(
    round: number,
    imageBlob: Buffer | null,
    imageMimeType: string | null,
    index?: number,
  ): NrGotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].imageBlob = imageBlob;
    entry.gameOfTheMonth[i].imageMimeType = imageMimeType;
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

export async function updateNrGotmGameImageInDatabase(
  opts: {
    rowId?: number | null;
    round?: number;
    gameIndex?: number;
    imageBlob: Buffer | null;
    imageMimeType: string | null;
  },
): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    if (opts.rowId) {
      await connection.execute(
        `UPDATE NR_GOTM_ENTRIES
            SET IMAGE_BLOB = :imageBlob,
                IMAGE_MIME_TYPE = :imageMimeType
          WHERE NR_GOTM_ID = :rowId`,
        { rowId: opts.rowId, imageBlob: opts.imageBlob, imageMimeType: opts.imageMimeType },
        { autoCommit: true },
      );
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

    const result = await connection.execute<{
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    }>(
      `SELECT NR_GOTM_ID,
              ROUND_NUMBER,
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

    const gi = Number(gameIndex);
    if (!Number.isInteger(gi) || gi < 0 || gi >= rows.length) {
      throw new Error(
        `Game index ${gameIndex} is out of range for NR-GOTM round ${round} (have ${rows.length} games).`,
      );
    }

    const targetRow = rows[gi] as {
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    };

    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET IMAGE_BLOB = :imageBlob,
              IMAGE_MIME_TYPE = :imageMimeType
        WHERE NR_GOTM_ID = :rowId`,
      {
        rowId: targetRow.NR_GOTM_ID,
        imageBlob: opts.imageBlob,
        imageMimeType: opts.imageMimeType,
      },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

export async function updateNrGotmGameFieldInDatabase(
  opts: {
    rowId?: number | null;
    round?: number;
    gameIndex?: number;
    field: NrGotmEditableField;
    value: string | null;
  },
): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();

  try {
    const columnMap: Record<NrGotmEditableField, string> = {
      title: "GAME_TITLE",
      threadId: "THREAD_ID",
      redditUrl: "REDDIT_URL",
    };

    const columnName = columnMap[opts.field];

    // Prefer rowId if provided
    if (opts.rowId) {
      await connection.execute(
        `UPDATE NR_GOTM_ENTRIES
            SET ${columnName} = :value
          WHERE NR_GOTM_ID = :rowId`,
        {
          rowId: opts.rowId,
          value: opts.value,
        },
        { autoCommit: true },
      );
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
    const result = await connection.execute<{
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    }>(
      `SELECT NR_GOTM_ID,
              ROUND_NUMBER,
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

    const gi = Number(gameIndex);
    if (!Number.isInteger(gi) || gi < 0 || gi >= rows.length) {
      throw new Error(
        `Game index ${gameIndex} is out of range for NR-GOTM round ${round} (have ${rows.length} games).`,
      );
    }

    const targetRow = rows[gi] as {
      NR_GOTM_ID: number;
      ROUND_NUMBER: number;
      GAME_INDEX: number;
    };

    const rowId = targetRow.NR_GOTM_ID;

    await connection.execute(
      `UPDATE NR_GOTM_ENTRIES
          SET ${columnName} = :value
        WHERE NR_GOTM_ID = :rowId`,
      {
        rowId,
        value: opts.value,
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
): Promise<number[]> {
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

    const insertedIds: number[] = [];

    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const result = await connection.execute(
        `INSERT INTO NR_GOTM_ENTRIES (
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
         )
         RETURNING NR_GOTM_ID INTO :outId`,
        {
          round,
          monthYear,
          gameIndex: i,
          title: g.title,
          threadId: g.threadId ?? null,
          redditUrl: g.redditUrl ?? null,
          imageBlob: g.imageBlob ?? null,
          imageMimeType: g.imageMimeType ?? null,
          outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: true },
      );

      const outIdArr: any = (result.outBinds as any)?.outId;
      const newId = Array.isArray(outIdArr) ? outIdArr[0] : outIdArr;
      if (newId !== undefined && newId !== null) {
        insertedIds.push(Number(newId));
      }
    }

    return insertedIds;
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

