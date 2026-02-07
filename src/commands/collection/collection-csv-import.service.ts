import axios from "axios";
import { Attachment, AttachmentBuilder } from "discord.js";
import ExcelJS from "exceljs";
import {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../../classes/UserGameCollection.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../../config/gamedbCsvPlatformMap.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { resolveGameCompletionPlatformId } from "../game-completion/completion-autocomplete.utils.js";

export type CollectionCsvParsedRow = {
  rowIndex: number;
  title: string;
  platformRaw: string | null;
  platformId: number | null;
  ownershipRaw: string | null;
  ownershipType: CollectionOwnershipType;
  noteRaw: string | null;
  note: string | null;
  sourceGameDbId: number | null;
  sourceIgdbId: number | null;
};

export type CsvValidationError = {
  rowIndex: number;
  column: string;
  message: string;
};

export const COLLECTION_CSV_TEMPLATE_VERSION = "1.0";
export const COLLECTION_CSV_TEMPLATE_FILENAME = "rpgclub_collection_import_template_v1.xlsx";
export const COLLECTION_CSV_EXAMPLE_NOTE = "EXAMPLE ROW - DELETE BEFORE IMPORT";

const HEADER_ALIASES: Record<string, string> = {
  title: "title",
  game: "title",
  game_title: "title",
  game_title_name: "title",
  game_name: "title",
  "game title": "title",
  platform: "platform",
  platform_name: "platform",
  platform_id: "platform",
  ownership: "ownership_type",
  ownership_type: "ownership_type",
  ownershiptype: "ownership_type",
  "ownership type": "ownership_type",
  note: "note",
  notes: "note",
  gamedb_id: "gamedb_id",
  gamedb: "gamedb_id",
  "gamedb id": "gamedb_id",
  igdb_id: "igdb_id",
  igdb: "igdb_id",
  "igdb id": "igdb_id",
};

const REQUIRED_HEADERS = ["title"];

export async function buildCollectionCsvTemplateAttachment(): Promise<AttachmentBuilder> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "RPGClubBotTs";
  workbook.created = new Date();

  const templateSheet = workbook.addWorksheet("Template");
  templateSheet.addRow([
    "title",
    "platform",
    "ownership_type",
    "note",
    "gamedb_id",
    "igdb_id",
  ]);
  templateSheet.addRow([
    "The Legend of Zelda: Breath of the Wild",
    "Switch",
    "Physical",
    COLLECTION_CSV_EXAMPLE_NOTE,
    "",
    "",
  ]);
  templateSheet.columns = [
    { width: 38 },
    { width: 18 },
    { width: 18 },
    { width: 40 },
    { width: 12 },
    { width: 12 },
  ];
  templateSheet.getRow(1).font = { bold: true };

  const guideSheet = workbook.addWorksheet("Guide");
  guideSheet.addRow(["Column", "Required", "Description", "Example"]);
  guideSheet.addRow([
    "title",
    "Yes",
    "Game title used for matching in GameDB.",
    "Chrono Trigger",
  ]);
  guideSheet.addRow([
    "platform",
    "No",
    "Platform name or id. Leave blank if unknown.",
    "Switch",
  ]);
  guideSheet.addRow([
    "ownership_type",
    "No",
    "Digital, Physical, Subscription, or Other. Defaults to Digital.",
    "Digital",
  ]);
  guideSheet.addRow([
    "note",
    "No",
    "Optional note, 500 characters max.",
    "Gifted copy from a friend",
  ]);
  guideSheet.addRow([
    "gamedb_id",
    "No",
    "GameDB id to skip title matching. Only one of gamedb_id or igdb_id.",
    "12345",
  ]);
  guideSheet.addRow([
    "igdb_id",
    "No",
    "IGDB numeric id to import new titles. Only one of gamedb_id or igdb_id.",
    "1020",
  ]);
  guideSheet.columns = [
    { width: 18 },
    { width: 10 },
    { width: 60 },
    { width: 24 },
  ];
  guideSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new AttachmentBuilder(Buffer.from(buffer), {
    name: COLLECTION_CSV_TEMPLATE_FILENAME,
  });
}

export async function fetchCsvAttachment(attachment: Attachment): Promise<string | null> {
  try {
    const response = await axios.get(attachment.url, { responseType: "arraybuffer" });
    return Buffer.from(response.data).toString("utf-8");
  } catch {
    return null;
  }
}

export async function parseCollectionCsvImportText(csvText: string): Promise<{
  rows: CollectionCsvParsedRow[];
  errors: CsvValidationError[];
}> {
  const normalizedText = csvText.replace(/^\uFEFF/, "");
  const { rows, errors: parseErrors } = parseCsvText(normalizedText);
  if (parseErrors.length) {
    return { rows: [], errors: parseErrors };
  }

  if (!rows.length) {
    return {
      rows: [],
      errors: [{
        rowIndex: 1,
        column: "file",
        message: "CSV file is empty.",
      }],
    };
  }

  const [headerRow, ...dataRows] = rows;
  const headerValues = headerRow?.values ?? [];
  const headerMap = buildHeaderMap(headerValues);
  const headerErrors = validateHeaders(headerMap);
  if (headerErrors.length) {
    return { rows: [], errors: headerErrors };
  }

  const results: CollectionCsvParsedRow[] = [];
  const validationErrors: CsvValidationError[] = [];

  for (const row of dataRows) {
    const rowIndex = row.rowIndex;
    const values = row.values;
    if (values.every((value) => !String(value ?? "").trim())) {
      continue;
    }

    const title = getColumnValue(values, headerMap, "title");
    const platformRaw = getColumnValue(values, headerMap, "platform");
    const ownershipRaw = getColumnValue(values, headerMap, "ownership_type");
    const noteRaw = getColumnValue(values, headerMap, "note");
    const gameDbRaw = getColumnValue(values, headerMap, "gamedb_id");
    const igdbRaw = getColumnValue(values, headerMap, "igdb_id");

    if (noteRaw && noteRaw.toUpperCase().includes("EXAMPLE ROW")) {
      continue;
    }

    const rowErrors: CsvValidationError[] = [];
    if (!title) {
      rowErrors.push({
        rowIndex,
        column: "title",
        message: "Title is required.",
      });
    }

    let gameDbId: number | null = null;
    if (gameDbRaw) {
      gameDbId = parsePositiveInteger(gameDbRaw);
      if (!gameDbId) {
        rowErrors.push({
          rowIndex,
          column: "gamedb_id",
          message: "GameDB id must be a positive number.",
        });
      }
    }

    let igdbId: number | null = null;
    if (igdbRaw) {
      igdbId = parsePositiveInteger(igdbRaw);
      if (!igdbId) {
        rowErrors.push({
          rowIndex,
          column: "igdb_id",
          message: "IGDB id must be a positive number.",
        });
      }
    }

    if (gameDbId && igdbId) {
      rowErrors.push({
        rowIndex,
        column: "gamedb_id",
        message: "Provide only one of gamedb_id or igdb_id.",
      });
    }

    const ownershipType = normalizeOwnershipType(ownershipRaw, rowIndex, rowErrors);

    const note = noteRaw ? sanitizeValue(noteRaw) : null;
    if (note && note.length > 500) {
      rowErrors.push({
        rowIndex,
        column: "note",
        message: "Note must be 500 characters or fewer.",
      });
    }

    let platformId: number | null = null;
    if (platformRaw) {
      platformId = await resolveCsvPlatformId(platformRaw);
      if (!platformId) {
        rowErrors.push({
          rowIndex,
          column: "platform",
          message: "Platform not recognized. Use a platform name or id.",
        });
      }
    }

    if (rowErrors.length) {
      validationErrors.push(...rowErrors);
      continue;
    }

    results.push({
      rowIndex,
      title,
      platformRaw: platformRaw || null,
      platformId,
      ownershipRaw: ownershipRaw || null,
      ownershipType,
      noteRaw: noteRaw || null,
      note: note ?? null,
      sourceGameDbId: gameDbId,
      sourceIgdbId: igdbId,
    });
  }

  return { rows: results, errors: validationErrors };
}

function parseCsvText(csvText: string): {
  rows: Array<{ rowIndex: number; values: string[] }>;
  errors: CsvValidationError[];
} {
  const rows: Array<{ rowIndex: number; values: string[] }> = [];
  const errors: CsvValidationError[] = [];

  let currentRow: string[] = [];
  let currentValue = "";
  let inQuotes = false;
  let rowIndex = 1;
  let columnIndex = 1;

  const pushValue = () => {
    currentRow.push(currentValue);
    currentValue = "";
    columnIndex += 1;
  };

  const pushRow = () => {
    rows.push({ rowIndex, values: currentRow });
    currentRow = [];
    rowIndex += 1;
    columnIndex = 1;
  };

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        currentValue += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      pushValue();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      pushValue();
      pushRow();
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      continue;
    }

    currentValue += char;
  }

  if (inQuotes) {
    errors.push({
      rowIndex,
      column: `col${columnIndex}`,
      message: "Unterminated quoted field.",
    });
  }

  if (currentValue.length || currentRow.length) {
    pushValue();
    pushRow();
  }

  return { rows, errors };
}

function normalizeHeader(value: string): string {
  const cleaned = value
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "");
  return cleaned;
}

function buildHeaderMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((value, index) => {
    const normalized = normalizeHeader(String(value ?? ""));
    const key = HEADER_ALIASES[normalized] ?? "";
    if (!key || map.has(key)) return;
    map.set(key, index);
  });
  return map;
}

function validateHeaders(headerMap: Map<string, number>): CsvValidationError[] {
  const errors: CsvValidationError[] = [];
  for (const required of REQUIRED_HEADERS) {
    if (!headerMap.has(required)) {
      errors.push({
        rowIndex: 1,
        column: required,
        message: `Missing required column "${required}".`,
      });
    }
  }
  return errors;
}

function getColumnValue(
  rowValues: string[],
  headerMap: Map<string, number>,
  column: string,
): string {
  const index = headerMap.get(column);
  if (index == null) return "";
  return sanitizeValue(rowValues[index] ?? "");
}

function sanitizeValue(value: string): string {
  return sanitizeUserInput(value, { preserveNewlines: false }).trim();
}

function parsePositiveInteger(value: string): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizeOwnershipType(
  rawValue: string,
  rowIndex: number,
  errors: CsvValidationError[],
): CollectionOwnershipType {
  const cleaned = rawValue ? rawValue.trim() : "";
  if (!cleaned) {
    return "Digital";
  }
  const match = COLLECTION_OWNERSHIP_TYPES.find((item) =>
    item.toLowerCase() === cleaned.toLowerCase(),
  );
  if (!match) {
    errors.push({
      rowIndex,
      column: "ownership_type",
      message: "Ownership type must be Digital, Physical, Subscription, or Other.",
    });
    return "Digital";
  }
  return match;
}

function normalizePlatformKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function resolveCsvPlatformId(rawValue: string): Promise<number | null> {
  const normalized = normalizePlatformKey(rawValue);
  if (!normalized) return null;

  const mapped = GAMEDB_CSV_PLATFORM_MAP[normalized] ?? [];
  const candidates = mapped.length ? mapped : [rawValue];

  for (const candidate of candidates) {
    const platformId = await resolveGameCompletionPlatformId(candidate);
    if (platformId) return platformId;
  }

  return null;
}
