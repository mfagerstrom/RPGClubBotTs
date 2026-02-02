import axios from "axios";
import {
  normalizeCsvHeader,
  normalizeTitleKey,
  parseCsvLine,
  stripTitleDateSuffix,
} from "../../functions/CsvUtils.js";
import { type GotmAuditKind } from "../../classes/GotmAuditImport.js";
import { type GotmAuditParsedRow } from "./admin.types.js";

export async function fetchGotmAuditCsvText(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8");
  } catch {
    return null;
  }
}

export function parseGotmAuditCsv(csvText: string): GotmAuditParsedRow[] {
  const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!rows.length) return [];

  const header = parseCsvLine(rows[0]).map(normalizeCsvHeader);
  const findIndex = (labels: string[]) => header.findIndex((h) => labels.includes(h));

  const kindIndex = findIndex(["kind", "type"]);
  const roundIndex = findIndex(["round", "round number"]);
  const monthYearIndex = findIndex(["monthyear", "month year", "month/year"]);
  const monthIndex = findIndex(["month"]);
  const yearIndex = findIndex(["year"]);
  const titleIndex = findIndex(["title", "game title", "name"]);
  const gameIndexIndex = findIndex(["game index", "gameindex", "index"]);
  const threadIndex = findIndex(["thread id", "threadid", "thread"]);
  const redditIndex = findIndex(["reddit url", "redditurl", "reddit"]);
  const gameDbIndex = findIndex([
    "gamedb id",
    "gamedb_id",
    "gamedb game id",
    "gamedb game_id",
    "gamedbgameid",
    "gamedbid",
  ]);

  if (kindIndex < 0 || roundIndex < 0 || titleIndex < 0) {
    return [];
  }
  if (monthYearIndex < 0 && (monthIndex < 0 || yearIndex < 0)) {
    return [];
  }

  const items: GotmAuditParsedRow[] = [];
  const roundCounters = new Map<string, number>();

  rows.slice(1).forEach((line, idx) => {
    const fields = parseCsvLine(line);
    const kindRaw = fields[kindIndex]?.trim() ?? "";
    const kind = normalizeGotmAuditKind(kindRaw);
    if (!kind) return;

    const roundRaw = fields[roundIndex]?.trim() ?? "";
    const roundNumber = Number(roundRaw);
    if (!Number.isInteger(roundNumber) || roundNumber <= 0) return;

    const titleRaw = fields[titleIndex]?.trim() ?? "";
    const gameTitle = titleRaw.trim();
    if (!gameTitle) return;

    const monthYear = resolveGotmAuditMonthYear(
      fields,
      monthYearIndex,
      monthIndex,
      yearIndex,
    );
    if (!monthYear) return;

    const key = `${kind}:${roundNumber}`;
    const autoIndex = roundCounters.get(key) ?? 0;
    const gameIndexRaw = gameIndexIndex >= 0 ? fields[gameIndexIndex]?.trim() ?? "" : "";
    const parsedIndex = Number(gameIndexRaw);
    const normalizedIndex = Number.isInteger(parsedIndex) && parsedIndex >= 0
      ? parsedIndex > 0
        ? parsedIndex - 1
        : 0
      : null;
    const gameIndex = normalizedIndex ?? autoIndex;
    const nextIndex = Math.max(autoIndex, gameIndex) + 1;
    roundCounters.set(key, nextIndex);

    const threadId = threadIndex >= 0 ? fields[threadIndex]?.trim() ?? "" : "";
    const redditUrl = redditIndex >= 0 ? fields[redditIndex]?.trim() ?? "" : "";
    const gameDbRaw = gameDbIndex >= 0 ? fields[gameDbIndex]?.trim() ?? "" : "";
    const gameDbParsed = Number(gameDbRaw);
    const gameDbGameId =
      Number.isInteger(gameDbParsed) && gameDbParsed > 0 ? gameDbParsed : null;

    items.push({
      rowIndex: idx + 1,
      kind,
      roundNumber,
      monthYear,
      gameIndex,
      gameTitle,
      threadId: threadId || null,
      redditUrl: redditUrl || null,
      gameDbGameId,
    });
  });

  return items;
}

export function normalizeGotmAuditKind(value: string): GotmAuditKind | null {
  const cleaned = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("nr")) return "nr-gotm";
  if (cleaned === "gotm") return "gotm";
  return null;
}

export function resolveGotmAuditMonthYear(
  fields: string[],
  monthYearIndex: number,
  monthIndex: number,
  yearIndex: number,
): string | null {
  if (monthYearIndex >= 0) {
    const raw = fields[monthYearIndex]?.trim() ?? "";
    return raw || null;
  }

  const monthRaw = fields[monthIndex]?.trim() ?? "";
  const yearRaw = fields[yearIndex]?.trim() ?? "";
  if (!monthRaw || !yearRaw) return null;

  const month = normalizeMonthLabel(monthRaw);
  if (!month) return null;
  return `${month} ${yearRaw}`;
}

export function normalizeMonthLabel(value: string): string | null {
  const cleaned = value.trim().toLowerCase().replace(/\./g, "");
  if (!cleaned) return null;
  if (/^\d{1,2}$/.test(cleaned)) {
    const monthNumber = Number(cleaned);
    const names = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    return names[monthNumber - 1] ?? null;
  }

  const shortMap: Record<string, string> = {
    jan: "January",
    feb: "February",
    mar: "March",
    apr: "April",
    may: "May",
    jun: "June",
    jul: "July",
    aug: "August",
    sep: "September",
    sept: "September",
    oct: "October",
    nov: "November",
    dec: "December",
  };

  if (shortMap[cleaned]) {
    return shortMap[cleaned];
  }

  return value.trim();
}

export function findExactGameDbMatch(
  gameTitle: string,
  results: Array<{ id: number; title: string }>,
): { id: number; title: string } | null {
  const rawTitle = stripTitleDateSuffix(gameTitle).trim();
  if (!rawTitle) return null;
  const normalized = normalizeTitleKey(rawTitle);
  if (!normalized) return null;
  const exact = results.filter((game) => normalizeTitleKey(game.title) === normalized);
  if (exact.length !== 1) return null;
  return exact[0] ?? null;
}
