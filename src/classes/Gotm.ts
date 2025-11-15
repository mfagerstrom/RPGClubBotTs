import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

// Load JSON as text to preserve large integers (Discord snowflakes) as strings.
// Convert threadId numeric literals to strings before JSON.parse to avoid precision loss.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_PATH = resolve(__dirname, '../data/gotm.json');
const rawJson = readFileSync(DATA_PATH, 'utf8');
const normalizedJson = rawJson
  .replace(/("threadId"\s*:\s*)(\d+)/g, '$1"$2"')
  .replace(/("votingResultsMessageId"\s*:\s*)(\d+)/g, '$1"$2"');
let gotmData: GotmEntry[];
try {
  gotmData = JSON.parse(normalizedJson) as GotmEntry[];
} catch {
  // Fallback: strip BOM if present
  gotmData = JSON.parse(normalizedJson.replace(/^\uFEFF/, '')) as GotmEntry[];
}

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
] as const;

function parseYear(value: string): number | null {
  const m = value.match(/(\d{4})\s*$/);
  return m ? Number(m[1]) : null;
}

function parseMonthLabel(value: string): string {
  // Remove trailing year and trim
  const label = value.replace(/\s*\d{4}\s*$/, '').trim();
  return label;
}

function monthNumberToName(month: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return MONTHS[month - 1];
}

export default class Gotm {
  static all(): GotmEntry[] {
    return gotmData.slice();
  }

  static getByRound(round: number): GotmEntry[] {
    return gotmData.filter((e) => e.round === round);
  }

  static getByYearMonth(year: number, month: number | string): GotmEntry[] {
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];

    const wantedLabel: string | null =
      typeof month === 'number'
        ? monthNumberToName(month)
        : month?.trim() ?? null;

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
    const yearNum = Number(year);
    if (!Number.isFinite(yearNum)) return [];
    return gotmData.filter((e) => parseYear(e.monthYear) === yearNum);
  }

  static searchByTitle(query: string): GotmEntry[] {
    if (!query?.trim()) return [];
    const q = query.toLowerCase();
    return gotmData.filter((e) =>
      e.gameOfTheMonth.some((g) => g.title.toLowerCase().includes(q))
    );
  }

  private static getRoundEntry(round: number): GotmEntry | null {
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
        `Round ${entry.round} has ${arrLen} games; provide an index (0-${arrLen - 1}).`
      );
    }
    if (!Number.isInteger(index) || index < 0 || index >= arrLen) {
      throw new Error(`Index ${index} out of bounds for round ${entry.round}.`);
    }
    return index;
  }

  static updateTitleByRound(round: number, newTitle: string, index?: number): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].title = newTitle;
    return entry;
  }

  static updateThreadIdByRound(round: number, threadId: string | null, index?: number): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    // Coerce to string to preserve snowflake precision when saved
    entry.gameOfTheMonth[i].threadId = threadId === null ? null : String(threadId);
    return entry;
  }

  static updateRedditUrlByRound(round: number, redditUrl: string | null, index?: number): GotmEntry | null {
    const entry = this.getRoundEntry(round);
    if (!entry) return null;
    const i = this.resolveIndex(entry, index);
    entry.gameOfTheMonth[i].redditUrl = redditUrl;
    return entry;
  }

  static save(): void {
    // Persist current in-memory data back to JSON file (pretty-printed)
    // Ensure all threadId values are strings (or null) before writing
    const normalized: GotmEntry[] = gotmData.map((e) => ({
      round: e.round,
      monthYear: e.monthYear,
      votingResultsMessageId:
        e.votingResultsMessageId === null || e.votingResultsMessageId === undefined
          ? null
          : String(e.votingResultsMessageId),
      gameOfTheMonth: e.gameOfTheMonth.map((g) => ({
        title: g.title,
        threadId: g.threadId === null ? null : String(g.threadId),
        redditUrl: g.redditUrl ?? null,
      })),
    }));
    const json = JSON.stringify(normalized, null, 2);
    writeFileSync(DATA_PATH, json, { encoding: 'utf8' });
  }
}
