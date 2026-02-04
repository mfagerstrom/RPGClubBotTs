import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type CommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type User,
} from "discord.js";
import Member, { type ICompletionRecord } from "../../classes/Member.js";
import Game from "../../classes/Game.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { shouldRenderPrevNextButtons } from "../../functions/PaginationUtils.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { GameDb } from "../gamedb.command.js";
import {
  COMPLETION_PAGE_SIZE,
} from "../profile.command.js";

export type CommonCompletionSort =
  | "title_asc"
  | "title_desc"
  | "date_desc"
  | "date_asc";

export const COMMON_COMPLETION_SORT_OPTIONS: Array<{
  label: string;
  value: CommonCompletionSort;
}> = [
  { label: "Date (Newest First)", value: "date_desc" },
  { label: "Date (Oldest First)", value: "date_asc" },
  { label: "Title (A-Z)", value: "title_asc" },
  { label: "Title (Z-A)", value: "title_desc" },
];

type InteractionLike =
  | CommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

type IUserCompletionSummary = {
  entries: ICompletionRecord[];
  latest: ICompletionRecord;
};

type ICommonCompletionRow = {
  gameId: number;
  title: string;
  left: IUserCompletionSummary;
  right: IUserCompletionSummary;
  latestSharedDate: Date | null;
  years: Set<number>;
  hasUnknownDate: boolean;
  platforms: Set<number>;
};

type ICommonCompletionState = {
  leftId: string;
  rightId: string;
  sort: CommonCompletionSort;
  year: number | "unknown" | null;
  platformId: number | null;
  query?: string;
};

const NO_QUERY_TOKEN = "-";
const YEAR_ALL_TOKEN = "all";
const YEAR_UNKNOWN_TOKEN = "unknown";
const PLATFORM_ALL_TOKEN = "all";

function normalizeSort(sort: string): CommonCompletionSort {
  if (sort === "title_asc" || sort === "title_desc" || sort === "date_asc" || sort === "date_desc") {
    return sort;
  }
  return "date_desc";
}

function normalizeYearToken(year: number | "unknown" | null): string {
  if (year == null) return YEAR_ALL_TOKEN;
  if (year === "unknown") return YEAR_UNKNOWN_TOKEN;
  return String(year);
}

function parseYearToken(raw: string): number | "unknown" | null {
  if (!raw || raw === YEAR_ALL_TOKEN) return null;
  if (raw === YEAR_UNKNOWN_TOKEN) return "unknown";
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizePlatformToken(platformId: number | null): string {
  if (platformId == null) return PLATFORM_ALL_TOKEN;
  return String(platformId);
}

function parsePlatformToken(raw: string): number | null {
  if (!raw || raw === PLATFORM_ALL_TOKEN) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function encodeQueryToken(query: string | undefined, maxLength: number): string {
  const trimmed = query?.trim();
  if (!trimmed) return NO_QUERY_TOKEN;
  if (maxLength <= 0) return NO_QUERY_TOKEN;

  let value = trimmed;
  while (value.length > 0) {
    const encoded = Buffer.from(value, "utf8").toString("base64url");
    if (encoded.length <= maxLength) return encoded;
    value = value.slice(0, -1);
  }
  return NO_QUERY_TOKEN;
}

function decodeQueryToken(token: string): string | undefined {
  if (!token || token === NO_QUERY_TOKEN) return undefined;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8").trim();
    return decoded.length ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function buildCommonViewCustomId(
  state: ICommonCompletionState,
  page: number,
): string {
  const base = `comp-common-view:${state.leftId}:${state.rightId}:${state.sort}:${normalizeYearToken(state.year)}:${normalizePlatformToken(state.platformId)}:${page}:`;
  const maxQueryLength = Math.max(100 - base.length, 0);
  const queryToken = encodeQueryToken(state.query, maxQueryLength);
  return `${base}${queryToken}`;
}

function buildCommonBackCustomId(
  state: ICommonCompletionState,
  page: number,
): string {
  const base = `comp-common-back:${state.leftId}:${state.rightId}:${state.sort}:${normalizeYearToken(state.year)}:${normalizePlatformToken(state.platformId)}:${page}:`;
  const maxQueryLength = Math.max(100 - base.length, 0);
  const queryToken = encodeQueryToken(state.query, maxQueryLength);
  return `${base}${queryToken}`;
}

function buildCommonNavCustomId(
  state: ICommonCompletionState,
  page: number,
  direction: "prev" | "next",
): string {
  const base = `comp-common-nav:${state.leftId}:${state.rightId}:${state.sort}:${normalizeYearToken(state.year)}:${normalizePlatformToken(state.platformId)}:${page}:${direction}:`;
  const maxQueryLength = Math.max(100 - base.length, 0);
  const queryToken = encodeQueryToken(state.query, maxQueryLength);
  return `${base}${queryToken}`;
}

function parseCommonViewCustomId(
  customId: string,
): { state: ICommonCompletionState; page: number } | null {
  const parts = customId.split(":");
  if (parts.length !== 8 || parts[0] !== "comp-common-view") return null;
  const page = Number(parts[6]);
  if (!Number.isInteger(page) || page < 0) return null;

  return {
    page,
    state: {
      leftId: parts[1],
      rightId: parts[2],
      sort: normalizeSort(parts[3]),
      year: parseYearToken(parts[4]),
      platformId: parsePlatformToken(parts[5]),
      query: decodeQueryToken(parts[7]),
    },
  };
}

function parseCommonBackCustomId(
  customId: string,
): { state: ICommonCompletionState; page: number } | null {
  const parts = customId.split(":");
  if (parts.length !== 8 || parts[0] !== "comp-common-back") return null;
  const page = Number(parts[6]);
  if (!Number.isInteger(page) || page < 0) return null;

  return {
    page,
    state: {
      leftId: parts[1],
      rightId: parts[2],
      sort: normalizeSort(parts[3]),
      year: parseYearToken(parts[4]),
      platformId: parsePlatformToken(parts[5]),
      query: decodeQueryToken(parts[7]),
    },
  };
}

function parseCommonNavCustomId(
  customId: string,
): { state: ICommonCompletionState; page: number; direction: "prev" | "next" } | null {
  const parts = customId.split(":");
  if (parts.length !== 9 || parts[0] !== "comp-common-nav") return null;

  const page = Number(parts[6]);
  const direction = parts[7];
  if (!Number.isInteger(page) || page < 0) return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    state: {
      leftId: parts[1],
      rightId: parts[2],
      sort: normalizeSort(parts[3]),
      year: parseYearToken(parts[4]),
      platformId: parsePlatformToken(parts[5]),
      query: decodeQueryToken(parts[8]),
    },
    page,
    direction,
  };
}

function completionTimestamp(value: Date | null): number {
  return value ? value.getTime() : Number.NEGATIVE_INFINITY;
}

function sortCompletionEntries(a: ICompletionRecord, b: ICompletionRecord): number {
  const dateDiff = completionTimestamp(b.completedAt) - completionTimestamp(a.completedAt);
  if (dateDiff !== 0) return dateDiff;
  return b.completionId - a.completionId;
}

function buildPerGameMap(completions: ICompletionRecord[]): Map<number, IUserCompletionSummary> {
  const map = new Map<number, ICompletionRecord[]>();
  for (const completion of completions) {
    const list = map.get(completion.gameId);
    if (list) {
      list.push(completion);
    } else {
      map.set(completion.gameId, [completion]);
    }
  }

  const perGame = new Map<number, IUserCompletionSummary>();
  for (const [gameId, entries] of map.entries()) {
    const sorted = [...entries].sort(sortCompletionEntries);
    const latest = sorted[0];
    if (!latest) continue;
    perGame.set(gameId, { entries: sorted, latest });
  }

  return perGame;
}

function createCommonRows(
  leftCompletions: ICompletionRecord[],
  rightCompletions: ICompletionRecord[],
): ICommonCompletionRow[] {
  const leftPerGame = buildPerGameMap(leftCompletions);
  const rightPerGame = buildPerGameMap(rightCompletions);
  const rows: ICommonCompletionRow[] = [];

  for (const [gameId, left] of leftPerGame.entries()) {
    const right = rightPerGame.get(gameId);
    if (!right) continue;

    const years = new Set<number>();
    const platforms = new Set<number>();
    let hasUnknownDate = false;

    for (const entry of left.entries) {
      if (entry.completedAt) {
        years.add(entry.completedAt.getFullYear());
      } else {
        hasUnknownDate = true;
      }
      if (entry.platformId != null) {
        platforms.add(entry.platformId);
      }
    }

    for (const entry of right.entries) {
      if (entry.completedAt) {
        years.add(entry.completedAt.getFullYear());
      } else {
        hasUnknownDate = true;
      }
      if (entry.platformId != null) {
        platforms.add(entry.platformId);
      }
    }

    const leftDate = left.latest.completedAt;
    const rightDate = right.latest.completedAt;
    let latestSharedDate: Date | null = null;
    if (leftDate && rightDate) {
      latestSharedDate = leftDate.getTime() >= rightDate.getTime() ? leftDate : rightDate;
    } else if (leftDate) {
      latestSharedDate = leftDate;
    } else if (rightDate) {
      latestSharedDate = rightDate;
    }

    rows.push({
      gameId,
      title: left.latest.title,
      left,
      right,
      latestSharedDate,
      years,
      hasUnknownDate,
      platforms,
    });
  }

  return rows;
}

function applyFilters(
  rows: ICommonCompletionRow[],
  filters: Pick<ICommonCompletionState, "query" | "year" | "platformId">,
): ICommonCompletionRow[] {
  const titleFilter = filters.query?.trim().toLowerCase();
  return rows.filter((row) => {
    if (titleFilter && !row.title.toLowerCase().includes(titleFilter)) {
      return false;
    }
    if (filters.year === "unknown" && !row.hasUnknownDate) {
      return false;
    }
    if (typeof filters.year === "number" && !row.years.has(filters.year)) {
      return false;
    }
    if (filters.platformId != null && !row.platforms.has(filters.platformId)) {
      return false;
    }
    return true;
  });
}

function sortRows(rows: ICommonCompletionRow[], sort: CommonCompletionSort): ICommonCompletionRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sort === "title_asc") {
      return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    }
    if (sort === "title_desc") {
      return b.title.localeCompare(a.title, "en", { sensitivity: "base" });
    }

    const aTime = a.latestSharedDate ? a.latestSharedDate.getTime() : Number.NEGATIVE_INFINITY;
    const bTime = b.latestSharedDate ? b.latestSharedDate.getTime() : Number.NEGATIVE_INFINITY;

    if (sort === "date_asc") {
      if (aTime === bTime) {
        return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
      }
      if (aTime === Number.NEGATIVE_INFINITY) return 1;
      if (bTime === Number.NEGATIVE_INFINITY) return -1;
      return aTime - bTime;
    }

    if (aTime === bTime) {
      return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    }
    if (aTime === Number.NEGATIVE_INFINITY) return 1;
    if (bTime === Number.NEGATIVE_INFINITY) return -1;
    return bTime - aTime;
  });
  return sorted;
}

function formatYearLabel(year: number | "unknown" | null): string {
  if (year == null) return "All";
  if (year === "unknown") return "Unknown";
  return String(year);
}

function displayUserName(user: User): string {
  return user.displayName ?? user.username ?? user.id;
}

export async function renderCommonCompletionPage(
  interaction: InteractionLike,
  state: ICommonCompletionState,
  page: number,
  ephemeral: boolean,
): Promise<void> {
  const [leftUser, rightUser, leftCompletions, rightCompletions, allPlatforms] = await Promise.all([
    interaction.client.users.fetch(state.leftId).catch(() => interaction.user),
    interaction.client.users.fetch(state.rightId).catch(() => interaction.user),
    Member.getAllCompletions(state.leftId),
    Member.getAllCompletions(state.rightId),
    Game.getAllPlatforms(),
  ]);

  const platformMap = new Map(
    allPlatforms.map((platform) => [platform.id, platform.abbreviation ?? platform.name]),
  );

  const commonRows = createCommonRows(leftCompletions, rightCompletions);
  const filtered = applyFilters(commonRows, state);
  const sorted = sortRows(filtered, "title_asc");

  if (!sorted.length) {
    await safeReply(interaction, {
      content: "No shared completions matched those filters.",
      components: [],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * COMPLETION_PAGE_SIZE;
  const pageRows = sorted.slice(offset, offset + COMPLETION_PAGE_SIZE);

  const leftLabel = displayUserName(leftUser);
  const rightLabel = displayUserName(rightUser);
  const lines: string[] = [];

  for (let index = 0; index < pageRows.length; index += 1) {
    const row = pageRows[index];
    const position = offset + index + 1;
    lines.push(`${position}. ${row.title}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`Shared Completions: ${leftLabel} and ${rightLabel}`)
    .setDescription(lines.join("\n"))
    .setFooter({
      text: [
        `Total shared games: ${total}`,
        "Sort: Title (A-Z)",
        `Year: ${formatYearLabel(state.year)}`,
        `Platform: ${state.platformId == null
          ? "All"
          : formatPlatformDisplayName(platformMap.get(state.platformId) ?? "Unknown Platform")}`,
        `Title filter: ${state.query?.trim() || "None"}`,
        `Page ${safePage + 1} of ${totalPages}`,
      ].join(" | "),
    });

  const components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];
  const detailSelect = new StringSelectMenuBuilder()
    .setCustomId(buildCommonViewCustomId(state, safePage))
    .setPlaceholder("View /gamedb details for a shared title")
    .addOptions(
      pageRows.map((row) => ({
        label: row.title.slice(0, 100),
        value: String(row.gameId),
      })),
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(detailSelect));

  if (totalPages > 1) {
    const prevDisabled = safePage <= 0;
    const nextDisabled = safePage >= totalPages - 1;
    const prevButton = new ButtonBuilder()
      .setCustomId(buildCommonNavCustomId(state, safePage, "prev"))
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const nextButton = new ButtonBuilder()
      .setCustomId(buildCommonNavCustomId(state, safePage, "next"))
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton));
    }
  }

  await safeReply(interaction, {
    embeds: [embed],
    components,
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  });
}

export async function handleCommonCompletionGameSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parsed = parseCommonViewCustomId(interaction.customId);
  if (!parsed) return;

  const gameId = Number(interaction.values[0]);
  if (!Number.isInteger(gameId) || gameId <= 0) return;

  try {
    await interaction.deferUpdate();
  } catch {
    // ignore
  }

  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  const gameDb = new GameDb();
  const gamePayload = await gameDb.buildGameProfileMessagePayload(gameId, {
    includeActions: true,
    guildId: interaction.guildId ?? undefined,
  });

  const backButton = new ButtonBuilder()
    .setCustomId(buildCommonBackCustomId(parsed.state, parsed.page))
    .setLabel("Back to shared list")
    .setStyle(ButtonStyle.Secondary);
  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(backButton);

  if (!gamePayload) {
    await interaction.editReply({
      content: `No game found with ID ${gameId}.`,
      embeds: [],
      components: [backRow],
    });
    return;
  }

  await interaction.editReply({
    embeds: [],
    files: gamePayload.files,
    components: [...gamePayload.components, backRow],
    flags: buildComponentsV2Flags(ephemeral),
  });
}

export async function handleCommonCompletionNav(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseCommonNavCustomId(interaction.customId);
  if (!parsed) return;

  const targetPage = parsed.direction === "next" ? parsed.page + 1 : Math.max(parsed.page - 1, 0);

  try {
    await interaction.deferUpdate();
  } catch {
    // ignore
  }

  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  await renderCommonCompletionPage(interaction, parsed.state, targetPage, ephemeral);
}

export async function handleCommonCompletionBack(
  interaction: ButtonInteraction,
): Promise<void> {
  const parsed = parseCommonBackCustomId(interaction.customId);
  if (!parsed) return;

  try {
    await interaction.deferUpdate();
  } catch {
    // ignore
  }

  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
  await renderCommonCompletionPage(interaction, parsed.state, parsed.page, ephemeral);
}
