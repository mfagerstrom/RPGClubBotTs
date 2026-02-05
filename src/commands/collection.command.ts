import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonStyle,
  CommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type User,
  EmbedBuilder,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
  ButtonComponent,
  ModalComponent,
} from "discordx";
import {
  ContainerBuilder,
  ButtonBuilder as V2ButtonBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../classes/UserGameCollection.js";
import {
  type SteamCollectionMatchConfidence,
  type SteamCollectionImportStatus,
  countSteamCollectionImportResultReasons,
  createSteamCollectionImportSession,
  countSteamCollectionImportItems,
  getSteamAppGameDbMapByAppId,
  getSteamAppHistoricalMappedGameIds,
  getSteamCollectionImportItemById,
  getNextPendingSteamCollectionImportItem,
  getSteamCollectionImportById,
  getActiveSteamCollectionImportForUser,
  insertSteamCollectionImportItems,
  setSteamCollectionImportStatus,
  upsertSteamAppGameDbMap,
  updateSteamCollectionImportIndex,
  updateSteamCollectionImportItem,
} from "../classes/SteamCollectionImport.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
import {
  autocompleteGameCompletionPlatformStandardFirst,
  resolveGameCompletionPlatformId,
} from "./game-completion/completion-autocomplete.utils.js";
import {
  safeDeferReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  formatTableDate,
  parseCompletionDateInput,
} from "./profile.command.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
import { formatGameTitleWithYear } from "../functions/GameTitleAutocompleteUtils.js";
import { igdbService, type IGDBGame } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import { SteamApiError, steamApiService } from "../services/SteamApiService.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const COLLECTION_ENTRY_VALUE_PREFIX = "collection";
const COLLECTION_LIST_PAGE_SIZE = 10;
const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
const COLLECTION_LIST_FILTER_PREFIX = "collection-list-filter-v1";
const COLLECTION_LIST_FILTER_PANEL_PREFIX = "clf1";
const COLLECTION_LIST_FILTER_MODAL_PREFIX = "clfm1";
const COLLECTION_FILTER_TITLE_INPUT_ID = "collection-filter-title";
const COLLECTION_FILTER_PLATFORM_INPUT_ID = "collection-filter-platform";
const COLLECTION_STEAM_IMPORT_ACTIONS = [
  "start",
  "resume",
  "status",
  "pause",
  "cancel",
] as const;
const COLLECTION_STEAM_IMPORT_ACTION_PREFIX = "collection-steam-import-v1";
const COLLECTION_STEAM_CHOOSE_PREFIX = "collection-steam-choose-v1";
const COLLECTION_STEAM_REMAP_MODAL_PREFIX = "collection-steam-remap-v1";
const COLLECTION_STEAM_REMAP_INPUT_ID = "collection-steam-remap-title";
const COLLECTION_STEAM_GAME_ID_MODAL_PREFIX = "collection-steam-game-id-v1";
const COLLECTION_STEAM_GAME_ID_INPUT_ID = "collection-steam-game-id";

type CollectionSteamImportAction = (typeof COLLECTION_STEAM_IMPORT_ACTIONS)[number];
type CollectionSteamImportButtonAction = "skip" | "remap" | "game-id" | "pause";
type SteamImportCandidate = {
  gameId: number;
  title: string;
};

function safeV2TextContent(value: string, maxLength: number): string {
  const normalized = value.split("\0").join("").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function dedupeSteamImportCandidates(candidates: SteamImportCandidate[]): SteamImportCandidate[] {
  const seen = new Set<number>();
  const deduped: SteamImportCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.gameId)) continue;
    seen.add(candidate.gameId);
    deduped.push(candidate);
    if (deduped.length >= 5) break;
  }
  return deduped;
}

function buildSteamImportReasonSummary(reasonCounts: Record<string, number>): string[] {
  const labels: Record<string, string> = {
    DUPLICATE: "duplicate",
    MANUAL_SKIP: "manual-skip",
    SKIP_MAPPED: "mapped-skip",
    ADD_FAILED: "add-failed",
    PLATFORM_UNRESOLVED: "platform-unresolved",
    NO_CANDIDATE: "no-candidate",
    INVALID_REMAP: "invalid-remap",
  };

  return Object.entries(reasonCounts)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${labels[reason] ?? reason.toLowerCase()}: ${count}`);
}

function logSteamImportEvent(message: string, meta: Record<string, string | number>): void {
  const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
  console.info(`[SteamImport] ${message} ${entries.join(" ")}`.trim());
}

function flattenErrorMessages(error: unknown, depth: number = 0): string[] {
  if (!error || depth > 3) return [];
  const anyError = error as any;
  const messages: string[] = [];
  const baseMessage = String(anyError?.message ?? "").trim();
  if (baseMessage) messages.push(baseMessage);

  const nested = [
    ...(Array.isArray(anyError?.errors) ? anyError.errors : []),
    ...(Array.isArray(anyError?.issues) ? anyError.issues : []),
  ];
  for (const item of nested) {
    const nestedMessage = String((item as any)?.message ?? "").trim();
    if (nestedMessage) messages.push(nestedMessage);
    messages.push(...flattenErrorMessages(item, depth + 1));
  }

  if (anyError?.cause) {
    messages.push(...flattenErrorMessages(anyError.cause, depth + 1));
  }

  return [...new Set(messages)].slice(0, 8);
}

function describeComponentForDebug(component: unknown): string {
  const anyComponent = component as any;
  const typeName = String(anyComponent?.constructor?.name ?? typeof component);
  return typeName;
}

function logSteamImportComponentDiagnostics(params: {
  importId: number;
  itemId: number;
  rowIndex: number;
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
}): void {
  params.components.forEach((component, index) => {
    try {
      (component as any)?.toJSON?.();
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logSteamImportEvent("render_component_invalid", {
        importId: params.importId,
        itemId: params.itemId,
        rowIndex: params.rowIndex,
        componentIndex: index,
      });
      console.error(
        "[SteamImport] component validation failed",
        JSON.stringify({
          importId: params.importId,
          itemId: params.itemId,
          rowIndex: params.rowIndex,
          componentIndex: index,
          componentType: describeComponentForDebug(component),
          messages,
        }),
      );
    }
  });
}

function buildCollectionSteamImportActionId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
}): string {
  const actionCode = params.action === "skip"
    ? "s"
    : params.action === "remap"
      ? "r"
      : params.action === "game-id"
        ? "i"
      : "p";
  return [
    COLLECTION_STEAM_IMPORT_ACTION_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    actionCode,
  ].join(":");
}

function parseCollectionSteamImportActionId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  action: CollectionSteamImportButtonAction;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_STEAM_IMPORT_ACTION_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;

  const actionCode = parts[4];
  const action = actionCode === "s"
    ? "skip"
    : actionCode === "r"
      ? "remap"
      : actionCode === "i"
        ? "game-id"
      : actionCode === "p"
        ? "pause"
        : null;
  if (!action) return null;

  return {
    ownerId: parts[1],
    importId,
    itemId,
    action,
  };
}

function buildCollectionSteamChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return [
    COLLECTION_STEAM_CHOOSE_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
    String(params.gameId),
  ].join(":");
}

function parseCollectionSteamChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_STEAM_CHOOSE_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  const gameId = Number(parts[4]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
    gameId,
  };
}

function buildCollectionSteamRemapModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_STEAM_REMAP_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionSteamRemapModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_STEAM_REMAP_MODAL_PREFIX) return null;

  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;

  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function buildCollectionSteamGameIdModalId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): string {
  return [
    COLLECTION_STEAM_GAME_ID_MODAL_PREFIX,
    params.ownerId,
    String(params.importId),
    String(params.itemId),
  ].join(":");
}

function parseCollectionSteamGameIdModalId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 4) return null;
  if (parts[0] !== COLLECTION_STEAM_GAME_ID_MODAL_PREFIX) return null;
  const importId = Number(parts[2]);
  const itemId = Number(parts[3]);
  if (!Number.isInteger(importId) || importId <= 0) return null;
  if (!Number.isInteger(itemId) || itemId <= 0) return null;
  return {
    ownerId: parts[1],
    importId,
    itemId,
  };
}

function parseSteamImportCandidates(raw: unknown): SteamImportCandidate[] {
  if (typeof raw !== "string") return [];
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<{ gameId?: number; title?: string }>;
    return dedupeSteamImportCandidates(parsed
      .map((value) => ({
        gameId: Number(value.gameId ?? 0),
        title: String(value.title ?? ""),
      }))
      .filter((value) => Number.isInteger(value.gameId) && value.gameId > 0 && value.title.length > 0));
  } catch {
    return [];
  }
}

function buildSteamImportMatchConfidence(
  searchTitle: string,
  candidates: SteamImportCandidate[],
): SteamCollectionMatchConfidence | null {
  if (!candidates.length) return null;
  return candidates[0].title.toLowerCase() === searchTitle.toLowerCase() ? "EXACT" : "FUZZY";
}

function normalizeSteamTitleForSearch(title: string): string {
  return title
    .replace(/\s*\((?:19|20)\d{2}\)\s*/g, " ")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExactSteamTitleMatch(steamTitle: string, gameDbTitle: string): boolean {
  return normalizeSteamTitleForSearch(steamTitle).toLowerCase() ===
    normalizeSteamTitleForSearch(gameDbTitle).toLowerCase();
}

async function buildSteamImportCandidates(title: string): Promise<SteamImportCandidate[]> {
  function normalizeCandidate(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreCandidate(search: string, candidate: string): number {
    if (candidate === search) return 100;
    if (candidate.startsWith(search)) return 85;
    if (candidate.includes(search)) return 70;
    const searchWords = search.split(" ").filter(Boolean);
    if (!searchWords.length) return 0;
    const matchedWords = searchWords.filter((word) => candidate.includes(word)).length;
    return Math.floor((matchedWords / searchWords.length) * 60);
  }

  const search = normalizeSteamTitleForSearch(
    sanitizeUserInput(title, { preserveNewlines: false }),
  );
  if (!search) return [];

  const results = await Game.searchGames(search);
  if (!results.length) return [];

  const normalizedSearch = normalizeCandidate(search);
  const ranked = results
    .map((game) => ({
      gameId: game.id,
      title: game.title,
      score: scoreCandidate(normalizedSearch, normalizeCandidate(game.title)),
    }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .filter((entry, index) => entry.score > 0 || index < 3)
    .slice(0, 10)
    .map((entry) => ({ gameId: entry.gameId, title: entry.title }));

  return dedupeSteamImportCandidates(ranked);
}

async function buildSteamImportCandidatesFromMappedIds(gameIds: number[]): Promise<SteamImportCandidate[]> {
  if (!gameIds.length) return [];
  const uniqueIds = Array.from(new Set(gameIds.filter((value) => Number.isInteger(value) && value > 0)));
  if (!uniqueIds.length) return [];
  const games = await Game.getGamesByIds(uniqueIds);
  const byId = new Map(games.map((game) => [game.id, game]));
  const ordered = uniqueIds
    .map((id) => byId.get(id))
    .filter((game): game is NonNullable<typeof game> => Boolean(game))
    .map((game) => ({ gameId: game.id, title: game.title }));
  return dedupeSteamImportCandidates(ordered);
}

function buildSteamImportItemMessage(params: {
  importId: number;
  rowIndex: number;
  totalCount: number;
  steamAppName: string;
  steamAppId: number;
  steamReleaseYear: number | null;
}): string {
  const releaseText = params.steamReleaseYear ? ` | Release: ${params.steamReleaseYear}` : "";
  const steamStoreUrl = `https://store.steampowered.com/app/${params.steamAppId}/`;
  return (
    `## Steam Import #${params.importId}\n` +
    `Row ${params.rowIndex}/${params.totalCount}\n` +
    `Steam: **${params.steamAppName}**${releaseText}\n` +
    `[Open in Steam Store](${steamStoreUrl})`
  );
}

async function buildSteamImportCandidatesContainer(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  headerText: string;
  headerHelpText?: string | null;
  candidates: SteamImportCandidate[];
}): Promise<ContainerBuilder> {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(params.headerText),
    ...(params.headerHelpText ? [new TextDisplayBuilder().setContent(params.headerHelpText)] : []),
  );
  if (!params.candidates.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No GameDB matches found yet."),
    );
    return container;
  }

  const gameIds = params.candidates.map((entry) => entry.gameId);
  const games = await Game.getGamesByIds(gameIds);
  const gamesWithPlatforms = await Game.attachPlatformsToGames(games);
  const gameMeta = new Map<number, { year: string; platforms: string }>();
  for (const game of gamesWithPlatforms) {
    const year = game.initialReleaseDate
      ? String(game.initialReleaseDate.getFullYear())
      : "TBD";
    const platformText = game.platforms.length
      ? game.platforms
        .map((platform) => platform.abbreviation ?? platform.name)
        .slice(0, 3)
        .join(", ")
      : "No platforms";
    gameMeta.set(game.id, { year, platforms: platformText });
  }

  params.candidates.forEach((entry) => {
    const metadata = gameMeta.get(entry.gameId) ?? {
      year: "TBD",
      platforms: "No platforms",
    };
    const sectionText = safeV2TextContent(
      `**${entry.title}**\n` +
      `-# **Release Year:** ${metadata.year} | **Platforms:** ${metadata.platforms} | ` +
      `**GameDB ID:** ${entry.gameId}`,
      900,
    );
    try {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(sectionText),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(
            buildCollectionSteamChooseId({
              ownerId: params.ownerId,
              importId: params.importId,
              itemId: params.itemId,
              gameId: entry.gameId,
            }),
          )
          .setLabel("Choose")
          .setStyle(ButtonStyle.Primary),
      );
      section.toJSON();
      container.addSectionComponents(section);
    } catch (error) {
      const messages = flattenErrorMessages(error);
      console.error(
        "[SteamImport] candidate section validation failed",
        JSON.stringify({
          importId: params.importId,
          itemId: params.itemId,
          gameDbGameId: entry.gameId,
          titleLength: entry.title.length,
          sectionTextLength: sectionText.length,
          messages,
        }),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          safeV2TextContent(`**${entry.title}** | #${entry.gameId}`, 300),
        ),
      );
    }
  });

  return container;
}

function buildSteamImportMessageContainer(content: string, thumbnailUrl: string | null): ContainerBuilder {
  const safeContent = safeV2TextContent(content, 3500);
  const container = new ContainerBuilder();
  if (!thumbnailUrl) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent),
    );
    return container;
  }
  try {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent),
    );
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
    section.toJSON();
    container.addSectionComponents(section);
  } catch (error) {
    const messages = flattenErrorMessages(error);
    console.error(
      "[SteamImport] header section validation failed",
      JSON.stringify({
        contentLength: safeContent.length,
        hasThumbnail: Boolean(thumbnailUrl),
        messages,
      }),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeV2TextContent(content, 1000)),
    );
  }
  return container;
}

function buildSteamImportTextContainer(content: string): ContainerBuilder {
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeV2TextContent(content, 3500)),
  );
}

function buildSteamImportIgdbContainer(params: {
  steamAppName: string;
  igdbRows: ActionRowBuilder<any>[];
  noResultsText: string | null;
}): ContainerBuilder {
  const igdbSearchUrl = `https://www.igdb.com/search?utf8=%E2%9C%93&type=1&q=${encodeURIComponent(params.steamAppName)}`;
  const igdbLink = `[Search IGDB for ${params.steamAppName}](${igdbSearchUrl})`;
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("### Import Game From IGDB"),
  );
  for (const row of params.igdbRows) {
    container.addActionRowComponents(row.toJSON());
  }
  if (params.noResultsText) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(params.noResultsText),
    );
  }
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Not seeing the right title? ${igdbLink}, find the **IGDB ID** and enter it using the button below.`,
    ),
  );
  return container;
}

function buildSteamImportActionsContainer(params: {
  helpText: string;
  controlRow: ActionRowBuilder<ButtonBuilder>;
}): ContainerBuilder {
  const container = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent("### Actions"),
    new TextDisplayBuilder().setContent(params.helpText),
  );
  container.addActionRowComponents(params.controlRow.toJSON());
  return container;
}

function parseCollectionSteamChooseButtonId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parsed = parseCollectionSteamChooseId(customId);
  if (!parsed) return null;
  return {
    ownerId: parsed.ownerId,
    importId: parsed.importId,
    itemId: parsed.itemId,
    gameId: parsed.gameId,
  };
}

function buildSteamImportItemButtons(params: {
  ownerId: string;
  importId: number;
  itemId: number;
}): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "remap",
        }),
      )
      .setLabel("Search a different title")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "game-id",
        }),
      )
      .setLabel("Enter GameDB or IGDB ID")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "skip",
        }),
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(
        buildCollectionSteamImportActionId({
          ownerId: params.ownerId,
          importId: params.importId,
          itemId: params.itemId,
          action: "pause",
        }),
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

type ResolvedCollectionGame =
  | { kind: "resolved"; gameId: number; title: string }
  | { kind: "choose"; titleQuery: string; options: IgdbSelectOption[] };

async function buildCollectionIgdbSelectOptions(results: IGDBGame[]): Promise<IgdbSelectOption[]> {
  const trimmedResults = results.slice(0, 50);
  const platformIds = Array.from(new Set(
    trimmedResults
      .flatMap((game) => game.platforms?.map((platform) => Number(platform.id)) ?? [])
      .filter((id) => Number.isInteger(id) && id > 0),
  ));
  const platformMap = platformIds.length
    ? await Game.getPlatformsByIgdbIds(platformIds)
    : new Map<number, { name: string; abbreviation?: string }>();

  return trimmedResults.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const platformText = (game.platforms ?? [])
      .map((platform) => platformMap.get(Number(platform.id)))
      .filter((platform): platform is NonNullable<typeof platform> => Boolean(platform))
      .map((platform) => platform.abbreviation ?? platform.name)
      .slice(0, 3)
      .join(", ");
    const summary = (game.summary ?? "No summary").replace(/\s+/g, " ").trim();
    const description = platformText
      ? `${platformText} | ${summary}`.slice(0, 100)
      : summary.slice(0, 100);
    return {
      id: game.id,
      label: `${game.name} (${year})`.slice(0, 100),
      description,
    };
  });
}

async function resolveCollectionGameForAdd(
  gameIdRaw: string,
): Promise<ResolvedCollectionGame> {
  const numericValue = Number(gameIdRaw);
  if (Number.isInteger(numericValue) && numericValue > 0) {
    const localGame = await Game.getGameById(numericValue);
    if (localGame) {
      return { kind: "resolved", gameId: localGame.id, title: localGame.title };
    }

    // Allow direct IGDB numeric ids when the title is not yet in GameDB.
    const importedById = await Game.importGameFromIgdb(numericValue);
    return { kind: "resolved", gameId: importedById.gameId, title: importedById.title };
  }

  const titleQuery = sanitizeUserInput(gameIdRaw, { preserveNewlines: false }).trim();
  if (!titleQuery) {
    throw new Error("Invalid game selection.");
  }

  const localResults = await Game.searchGames(titleQuery);
  const exactLocal = localResults.find(
    (game) => game.title.toLowerCase() === titleQuery.toLowerCase(),
  );
  if (exactLocal) {
    return { kind: "resolved", gameId: exactLocal.id, title: exactLocal.title };
  }

  const igdbSearch = await igdbService.searchGames(titleQuery, 10);
  if (!igdbSearch.results.length) {
    throw new Error("Could not find that title in GameDB or IGDB.");
  }

  return {
    kind: "choose",
    titleQuery,
    options: await buildCollectionIgdbSelectOptions(igdbSearch.results),
  };
}

function parseCollectionEntryAutocompleteValue(raw: string): number | null {
  const value = raw.trim();
  const match = /^collection:(\d+)$/i.exec(value);
  if (!match) return null;
  const entryId = Number(match[1]);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  return entryId;
}

function buildCollectionEntryAutocompleteValue(entryId: number): string {
  return `${COLLECTION_ENTRY_VALUE_PREFIX}:${entryId}`;
}

function formatCollectionEntryAutocompleteName(entry: {
  title: string;
  platformName: string | null;
  ownershipType: CollectionOwnershipType;
}): string {
  const platform = entry.platformName ?? "Unknown platform";
  return `${entry.title} | ${platform} | ${entry.ownershipType}`.slice(0, 100);
}

async function autocompleteCollectionGameTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }

  const results = await Game.searchGamesAutocomplete(query);
  await interaction.respond(
    results.slice(0, 25).map((game) => ({
      name: formatGameTitleWithYear(game).slice(0, 100),
      value: String(game.id),
    })),
  );
}

async function autocompleteCollectionEntry(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false });

  const results = await UserGameCollection.autocompleteEntries(
    interaction.user.id,
    query,
    25,
  );

  await interaction.respond(
    results.map((entry) => ({
      name: formatCollectionEntryAutocompleteName(entry),
      value: buildCollectionEntryAutocompleteValue(entry.entryId),
    })),
  );
}

function ownershipTypeToCode(value: CollectionOwnershipType | undefined): string {
  if (!value) return "_";
  return value[0]?.toUpperCase() ?? "_";
}

function ownershipCodeToType(code: string): CollectionOwnershipType | undefined {
  if (code === "D") return "Digital";
  if (code === "P") return "Physical";
  if (code === "S") return "Subscription";
  if (code === "O") return "Other";
  return undefined;
}

function nextOwnershipType(
  ownershipType: CollectionOwnershipType | undefined,
): CollectionOwnershipType | undefined {
  if (!ownershipType) return "Digital";
  if (ownershipType === "Digital") return "Physical";
  if (ownershipType === "Physical") return "Subscription";
  if (ownershipType === "Subscription") return "Other";
  return undefined;
}

function buildCollectionListNavId(params: {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
}): string {
  return [
    COLLECTION_LIST_NAV_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    String(params.page),
    params.isEphemeral ? "e" : "p",
    params.direction,
  ].join(":");
}

function parseCollectionListNavId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  direction: "prev" | "next";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_NAV_PREFIX) return null;

  const viewerUserId = parts[1];
  const targetUserId = parts[2];
  const page = Number(parts[3]);
  const visibility = parts[4];
  const direction = parts[5] as "prev" | "next";
  if (!Number.isInteger(page) || page < 0) return null;
  if (visibility !== "e" && visibility !== "p") return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    viewerUserId,
    targetUserId,
    page,
    isEphemeral: visibility === "e",
    direction,
  };
}

function buildCollectionFilterActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
}): string {
  return [
    COLLECTION_LIST_FILTER_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.isEphemeral ? "e" : "p",
    params.action,
  ].join(":");
}

function parseCollectionFilterActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  action: "open";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PREFIX) return null;
  const visibility = parts[3];
  const action = parts[4] as "open";
  if (visibility !== "e" && visibility !== "p") return null;
  if (action !== "open") return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    isEphemeral: visibility === "e",
    action,
  };
}

function encodeFilterPanelAction(action: "text" | "ownership" | "apply" | "clear" | "cancel"): string {
  if (action === "text") return "t";
  if (action === "ownership") return "o";
  if (action === "apply") return "a";
  if (action === "clear") return "c";
  return "x";
}

function decodeFilterPanelAction(code: string): "text" | "ownership" | "apply" | "clear" | "cancel" | null {
  if (code === "t") return "text";
  if (code === "o") return "ownership";
  if (code === "a") return "apply";
  if (code === "c") return "clear";
  if (code === "x") return "cancel";
  return null;
}

function buildCollectionFilterPanelActionId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
}): string {
  return [
    COLLECTION_LIST_FILTER_PANEL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    encodeFilterPanelAction(params.action),
  ].join(":");
}

function parseCollectionFilterPanelActionId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  action: "text" | "ownership" | "apply" | "clear" | "cancel";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_PANEL_PREFIX) return null;
  const visibility = parts[4];
  const action = decodeFilterPanelAction(parts[5]);
  if (visibility !== "e" && visibility !== "p") return null;
  if (!action) return null;

  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    action,
  };
}

function buildCollectionFilterModalId(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipCode: string;
}): string {
  return [
    COLLECTION_LIST_FILTER_MODAL_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    params.sourceMessageId,
    params.isEphemeral ? "e" : "p",
    params.ownershipCode,
  ].join(":");
}

function parseCollectionFilterModalId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 6) return null;
  if (parts[0] !== COLLECTION_LIST_FILTER_MODAL_PREFIX) return null;
  const visibility = parts[4];
  if (visibility !== "e" && visibility !== "p") return null;
  return {
    viewerUserId: parts[1],
    targetUserId: parts[2],
    sourceMessageId: parts[3],
    isEphemeral: visibility === "e",
    ownershipType: ownershipCodeToType(parts[5]),
  };
}

function buildCollectionFilterPanelContent(params: {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): string {
  const titleText = params.title ?? "(any)";
  const platformText = params.platform ?? "(any)";
  const ownershipText = params.ownershipType ?? "(any)";
  return (
    "### Filter collection results\n" +
    `> Title: ${titleText}\n` +
    `> Platform: ${platformText}\n` +
    `> Ownership: ${ownershipText}\n\n` +
    "Use **Edit Text** for title/platform, then **Apply**."
  );
}

function buildCollectionFilterPanelComponents(params: {
  viewerUserId: string;
  targetUserId: string;
  sourceMessageId: string;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
}): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "text",
          }),
        )
        .setLabel("Edit Text")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "ownership",
          }),
        )
        .setLabel(`Ownership: ${params.ownershipType ?? "Any"}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "apply",
          }),
        )
        .setLabel("Apply")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "clear",
          }),
        )
        .setLabel("Clear")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionFilterPanelActionId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            sourceMessageId: params.sourceMessageId,
            isEphemeral: params.isEphemeral,
            action: "cancel",
          }),
        )
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function parseCollectionFilterStateFromContent(content: string): {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const getValue = (label: "Title" | "Platform" | "Ownership"): string | undefined => {
    const match = content.match(new RegExp(`> ${label}:\\s*(.+)$`, "mi"));
    const value = match?.[1]?.trim();
    if (!value || value === "(any)") return undefined;
    return value;
  };

  const ownershipRaw = getValue("Ownership");
  const ownershipType = ownershipRaw === "Digital" ||
      ownershipRaw === "Physical" ||
      ownershipRaw === "Subscription" ||
      ownershipRaw === "Other"
    ? ownershipRaw
    : undefined;

  return {
    title: getValue("Title"),
    platform: getValue("Platform"),
    ownershipType,
  };
}

function collectTextDisplayContent(components: any[] | undefined, output: string[]): void {
  if (!components?.length) return;
  for (const component of components) {
    if (component && typeof component.content === "string") {
      output.push(component.content);
    }
    if (Array.isArray(component?.components)) {
      collectTextDisplayContent(component.components, output);
    }
  }
}

function parseCollectionFiltersFromListMessage(message: any): {
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
} {
  const textBlocks: string[] = [];
  collectTextDisplayContent(message?.components, textBlocks);
  const filterBlock = textBlocks.find((value) => value.includes("**Filters**"));
  if (!filterBlock) {
    return { title: undefined, platform: undefined, ownershipType: undefined };
  }

  const titleMatch = filterBlock.match(/title~([^|\n]+)/i);
  const platformMatch = filterBlock.match(/platform~([^|\n]+)/i);
  const ownershipMatch = filterBlock.match(/ownership=([A-Za-z]+)/i);
  const ownershipType = ownershipMatch?.[1] === "Digital" ||
      ownershipMatch?.[1] === "Physical" ||
      ownershipMatch?.[1] === "Subscription" ||
      ownershipMatch?.[1] === "Other"
    ? (ownershipMatch[1] as CollectionOwnershipType)
    : undefined;

  return {
    title: titleMatch?.[1]?.trim() || undefined,
    platform: platformMatch?.[1]?.trim() || undefined,
    ownershipType,
  };
}

async function buildCollectionThumbnails(
  entries: Array<{ gameId: number }>,
): Promise<Map<number, string>> {
  const thumbnailsByGameId = new Map<number, string>();
  for (const entry of entries) {
    if (thumbnailsByGameId.has(entry.gameId)) continue;
    const game = await Game.getGameById(entry.gameId);
    if (!game?.igdbId) continue;
    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      const imageId = details?.cover?.image_id ?? null;
      if (!imageId) continue;
      thumbnailsByGameId.set(
        entry.gameId,
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`,
      );
    } catch {
      // ignore thumbnail failures and continue rendering text rows
    }
  }
  return thumbnailsByGameId;
}

async function buildCollectionListResponse(params: {
  viewerUserId: string;
  targetUserId: string;
  memberLabel: string;
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
  page: number;
  isEphemeral: boolean;
}): Promise<{
  components: Array<ContainerBuilder | ActionRowBuilder<any>>;
  content?: string;
}> {
  const entries = await UserGameCollection.searchEntries({
    targetUserId: params.targetUserId,
    title: params.title,
    platform: params.platform,
    ownershipType: params.ownershipType,
  });

  const total = entries.length;
  if (!total) {
    return {
      content: params.targetUserId === params.viewerUserId
        ? "No collection entries matched your filters."
        : "No collection entries matched your filters for that member.",
      components: [],
    };
  }

  const pageCount = Math.max(1, Math.ceil(total / COLLECTION_LIST_PAGE_SIZE));
  const safePage = Math.min(Math.max(params.page, 0), pageCount - 1);
  const start = safePage * COLLECTION_LIST_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + COLLECTION_LIST_PAGE_SIZE);

  const headerTitle = params.targetUserId === params.viewerUserId
    ? (params.isEphemeral ? "Your game collection" : `${params.memberLabel}'s Game Collection`)
    : (params.isEphemeral ? `${params.memberLabel} collection` : `${params.memberLabel}'s Game Collection`);
  const filtersText = [
    params.title ? `title~${params.title}` : null,
    params.platform ? `platform~${params.platform}` : null,
    params.ownershipType ? `ownership=${params.ownershipType}` : null,
  ].filter(Boolean).join(" | ");
  const thumbnailsByGameId = await buildCollectionThumbnails(pageEntries);
  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];

  const contentContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${headerTitle}`),
  );
  for (const entry of pageEntries) {
    const platform = entry.platformName ?? "Unknown platform";
    const noteLine = entry.note ? `\n> Note: ${entry.note}` : "";
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${entry.title}\n` +
        `> Platform: ${platform}\n` +
        `> Ownership: ${entry.ownershipType}\n` +
        `> Added: ${formatTableDate(entry.createdAt)}${noteLine}`,
      ),
    );
    const thumb = thumbnailsByGameId.get(entry.gameId);
    if (thumb) {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb));
    }
    contentContainer.addSectionComponents(section);
  }
  const footerParts = [`Page ${safePage + 1}/${pageCount}`, `${total} total entries`];
  if (filtersText) {
    footerParts.push(`Filters: ${filtersText}`);
  }
  contentContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${footerParts.join(" | ")}`),
  );
  components.push(contentContainer);

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pageCount > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "prev",
          }),
        )
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            direction: "next",
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(
        buildCollectionFilterActionId({
          viewerUserId: params.viewerUserId,
          targetUserId: params.targetUserId,
          isEphemeral: params.isEphemeral,
          action: "open",
        }),
      )
      .setLabel("Filter Results")
      .setStyle(ButtonStyle.Primary),
  );
  components.push(row);

  return { components };
}

async function applyFiltersToSourceMessage(params: {
  interaction: ButtonInteraction;
  sourceMessageId: string;
  viewerUserId: string;
  targetUserId: string;
  isEphemeral: boolean;
  title: string | undefined;
  platform: string | undefined;
  ownershipType: CollectionOwnershipType | undefined;
}): Promise<boolean> {
  const channel = params.interaction.channel;
  if (!channel || !("messages" in channel)) {
    return false;
  }

  const memberLabel = params.targetUserId === params.viewerUserId
    ? params.interaction.user.username
    : "Member";
  const response = await buildCollectionListResponse({
    viewerUserId: params.viewerUserId,
    targetUserId: params.targetUserId,
    memberLabel,
    title: params.title,
    platform: params.platform,
    ownershipType: params.ownershipType,
    page: 0,
    isEphemeral: params.isEphemeral,
  });

  const sourceMessage = await (channel as any).messages.fetch(params.sourceMessageId).catch(() => null);
  if (!sourceMessage) {
    return false;
  }

  if (response.content) {
    await sourceMessage.edit({
      content: response.content,
      components: [],
    });
    return true;
  }

  await sourceMessage.edit({
    content: null,
    components: response.components,
  });
  return true;
}

async function closeFilterPanel(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate().catch(() => {});
  await (interaction.message as any)?.delete?.().catch(() => {});
}

@Discord()
@SlashGroup({ name: "collection", description: "Manage your owned game collection" })
@SlashGroup("collection")
export class CollectionCommand {
  private async applySteamImportSelection(params: {
    ownerId: string;
    gameId: number;
    itemId: number;
    steamAppId: number;
    reason: "AUTO_MATCH" | "MANUAL_REMAP";
  }): Promise<void> {
    const steamPlatformId = await resolveGameCompletionPlatformId("steam");
    const platformId = steamPlatformId ?? null;
    const platformWarning = steamPlatformId ? null : "Steam platform id not found; imported without platform.";

    try {
      const created = await UserGameCollection.addEntry({
        userId: params.ownerId,
        gameId: params.gameId,
        platformId,
        ownershipType: "Digital",
      });
      await updateSteamCollectionImportItem(params.itemId, {
        status: "ADDED",
        gameDbGameId: params.gameId,
        collectionEntryId: created.entryId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: steamPlatformId ? params.reason : "PLATFORM_UNRESOLVED",
        errorText: platformWarning,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: params.steamAppId,
        gameDbGameId: params.gameId,
        status: "MAPPED",
        createdBy: params.ownerId,
      });
    } catch (error: any) {
      const message = String(error?.message ?? "");
      const isDuplicate = /already exists/i.test(message);
      await updateSteamCollectionImportItem(params.itemId, {
        status: isDuplicate ? "SKIPPED" : "FAILED",
        gameDbGameId: params.gameId,
        matchConfidence: params.reason === "MANUAL_REMAP" ? "MANUAL" : undefined,
        resultReason: isDuplicate ? "DUPLICATE" : "ADD_FAILED",
        errorText: message || "Failed to add collection entry.",
      });
      if (isDuplicate) {
        await upsertSteamAppGameDbMap({
          steamAppId: params.steamAppId,
          gameDbGameId: params.gameId,
          status: "MAPPED",
          createdBy: params.ownerId,
        });
      }
    }
  }

  private async renderNextSteamImportItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
    ownerId: string,
  ): Promise<void> {
    const shouldUseInteractionUpdate = (interaction.isButton() || interaction.isStringSelectMenu()) &&
      !interaction.deferred &&
      !interaction.replied;
    const shouldUseModalUpdate = interaction.isModalSubmit();

    const session = await getSteamCollectionImportById(importId);
    if (!session || session.userId !== ownerId) {
      const payload = {
        content: null,
        components: [buildSteamImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    if (session.status !== "ACTIVE") {
      const payload = {
        content: null,
        components: [buildSteamImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    const nextItem = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!nextItem) {
      await setSteamCollectionImportStatus(session.importId, "COMPLETED");
      const stats = await countSteamCollectionImportItems(session.importId);
      const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
      logSteamImportEvent("completed", {
        userId: ownerId,
        importId: session.importId,
        added: stats.added,
        updated: stats.updated,
        skipped: stats.skipped,
        failed: stats.failed,
      });
      const reasonLines = buildSteamImportReasonSummary(reasonCounts);
      const done = [
        `## Steam Import #${session.importId}`,
        "Import completed.",
        `Added: ${stats.added}`,
        `Updated: ${stats.updated}`,
        `Skipped: ${stats.skipped}`,
        `Failed: ${stats.failed}`,
        ...(reasonLines.length ? ["", `Reasons: ${reasonLines.join(" | ")}`] : []),
      ].join("\n");
      const payload = {
        content: null,
        components: [buildSteamImportTextContainer(done)],
        flags: buildComponentsV2Flags(true),
      };
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, payload);
      } else {
        await interaction.editReply(payload);
      }
      return;
    }

    await updateSteamCollectionImportIndex(session.importId, nextItem.rowIndex);
    let candidates = parseSteamImportCandidates(nextItem.matchCandidateJson);
    let igdbComponents: ActionRowBuilder<any>[] | null = null;
    let igdbHasResults = false;
    if (!candidates.length) {
      const mapped = await getSteamAppGameDbMapByAppId(nextItem.steamAppId);
      if (mapped?.status === "MAPPED" && mapped.gameDbGameId) {
        const mappedGame = await Game.getGameById(mapped.gameDbGameId);
        if (mappedGame) {
          candidates = [{ gameId: mappedGame.id, title: mappedGame.title }];
        }
      }
      if (!candidates.length && mapped?.status !== "SKIPPED") {
        candidates = await buildSteamImportCandidates(nextItem.steamAppName);
      }

      if (candidates.length > 1) {
        const historicalGameIds = await getSteamAppHistoricalMappedGameIds({
          steamAppId: nextItem.steamAppId,
          excludeUserId: ownerId,
          limit: 5,
        });
        if (historicalGameIds.length) {
          const historicalCandidates = await buildSteamImportCandidatesFromMappedIds(historicalGameIds);
          candidates = dedupeSteamImportCandidates([...candidates, ...historicalCandidates]);
        }
      }
      const matchConfidence = buildSteamImportMatchConfidence(nextItem.steamAppName, candidates);
      await updateSteamCollectionImportItem(nextItem.itemId, {
        matchCandidateJson: candidates.length ? JSON.stringify(candidates) : null,
        matchConfidence,
        resultReason: !candidates.length && mapped?.status === "SKIPPED" ? "SKIP_MAPPED" : null,
      });
    }

    try {
      const igdbSearchTitle = normalizeSteamTitleForSearch(nextItem.steamAppName);
      const igdbSearch = await igdbService.searchGames(igdbSearchTitle, 10);
      igdbHasResults = igdbSearch.results.length > 0;
      const options = igdbHasResults
        ? await buildCollectionIgdbSelectOptions(igdbSearch.results)
        : [];
      const igdbSession = createIgdbSession(
        ownerId,
        options,
        async (selectionInteraction, igdbId) => {
          const currentSession = await getSteamCollectionImportById(session.importId);
          if (!currentSession || currentSession.userId !== ownerId || currentSession.status !== "ACTIVE") {
            await selectionInteraction.followUp({
              content: "This Steam import session is no longer active.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          const currentItem = await getSteamCollectionImportItemById(nextItem.itemId);
          if (
            !currentItem ||
            currentItem.importId !== session.importId ||
            currentItem.status !== "PENDING"
          ) {
            await selectionInteraction.followUp({
              content: "This import row is no longer pending.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return;
          }

          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            await updateSteamCollectionImportItem(currentItem.itemId, {
              matchCandidateJson: JSON.stringify([{
                gameId: imported.gameId,
                title: imported.title,
              } satisfies SteamImportCandidate]),
              matchConfidence: "MANUAL",
            });

            await this.applySteamImportSelection({
              ownerId,
              gameId: imported.gameId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              reason: "MANUAL_REMAP",
            });
            logSteamImportEvent("item_igdb_imported", {
              userId: ownerId,
              importId: session.importId,
              itemId: currentItem.itemId,
              steamAppId: currentItem.steamAppId,
              gameDbGameId: imported.gameId,
            });
          } catch (error: any) {
            await updateSteamCollectionImportItem(currentItem.itemId, {
              resultReason: "ADD_FAILED",
              errorText: error?.message ?? "Failed to import title from IGDB.",
            });
          }

          await this.renderNextSteamImportItem(
            selectionInteraction,
            session.importId,
            ownerId,
          );
        },
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    } catch {
      // if IGDB lookup fails, continue with regular actions
      const igdbSession = createIgdbSession(
        ownerId,
        [],
        async () => {},
        undefined,
        `No IGDB matches found for "${nextItem.steamAppName}". Try Search a different title.`,
      );
      igdbComponents = igdbSession.components;
    }

    const [steamReleaseYear, steamHeaderImageUrl] = await Promise.all([
      steamApiService.getAppReleaseYear(nextItem.steamAppId),
      steamApiService.getAppHeaderImageUrl(nextItem.steamAppId),
    ]);
    const singleExactCandidate = candidates.length === 1 &&
      isExactSteamTitleMatch(nextItem.steamAppName, candidates[0].title)
      ? candidates[0]
      : null;
    if (singleExactCandidate) {
      await this.applySteamImportSelection({
        ownerId,
        gameId: singleExactCandidate.gameId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        reason: "AUTO_MATCH",
      });
      logSteamImportEvent("item_auto_accepted_exact", {
        userId: ownerId,
        importId: session.importId,
        itemId: nextItem.itemId,
        steamAppId: nextItem.steamAppId,
        gameDbGameId: singleExactCandidate.gameId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, ownerId);
      return;
    }
    const content = buildSteamImportItemMessage({
      importId: session.importId,
      rowIndex: nextItem.rowIndex,
      totalCount: session.totalCount,
      steamAppName: nextItem.steamAppName,
      steamAppId: nextItem.steamAppId,
      steamReleaseYear,
    });
    const guidance = candidates.length > 1
      ? "Ambiguous match. Use Choose to select the right GameDB title."
      : candidates.length === 1
        ? "Single match found. Use Choose to confirm import."
        : "No matches yet. Use Search a different title to search again or Skip.";
    const helpText = "Use **Choose**, or choose **Search a different title**, **Enter GameDB or IGDB ID**, " +
      "**Skip**, or **Pause**.";
    const controlsRow = buildSteamImportItemButtons({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
    });
    const contentContainer = buildSteamImportMessageContainer(content, steamHeaderImageUrl);
    const candidatesContainer = await buildSteamImportCandidatesContainer({
      ownerId,
      importId: session.importId,
      itemId: nextItem.itemId,
      headerText: "### GameDB Match Candidates",
      headerHelpText: candidates.length > 1 ? guidance : null,
      candidates,
    });
    const igdbContainer = buildSteamImportIgdbContainer({
      steamAppName: nextItem.steamAppName,
      igdbRows: igdbComponents ?? [],
      noResultsText: igdbHasResults
        ? null
        : "No IGDB matches found for this title. Try Search a different title.",
    });
    const actionsContainer = buildSteamImportActionsContainer({
      helpText,
      controlRow: controlsRow,
    });
    const components = [contentContainer, candidatesContainer, igdbContainer, actionsContainer];
    logSteamImportComponentDiagnostics({
      importId: session.importId,
      itemId: nextItem.itemId,
      rowIndex: nextItem.rowIndex,
      components,
    });

    try {
      if (shouldUseInteractionUpdate || shouldUseModalUpdate) {
        await safeUpdate(interaction, {
          content: null,
          components,
          flags: buildComponentsV2Flags(true),
        });
        return;
      }
      await interaction.editReply({
        content: null,
        components,
        flags: buildComponentsV2Flags(true),
      });
    } catch (error) {
      const messages = flattenErrorMessages(error);
      logSteamImportEvent("render_failed", {
        importId: session.importId,
        itemId: nextItem.itemId,
        rowIndex: nextItem.rowIndex,
      });
      console.error(
        "[SteamImport] message render failed",
        JSON.stringify({
          importId: session.importId,
          itemId: nextItem.itemId,
          rowIndex: nextItem.rowIndex,
          steamAppId: nextItem.steamAppId,
          steamAppName: nextItem.steamAppName,
          candidateCount: candidates.length,
          messages,
        }),
      );
      throw error;
    }
  }

  @Slash({ name: "import-steam", description: "Import your collection from Steam" })
  async steamImport(
    @SlashChoice(
      ...COLLECTION_STEAM_IMPORT_ACTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "action",
      description: "Steam import action",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    action: CollectionSteamImportAction,
    @SlashOption({
      name: "steam_profile",
      description: "Steam profile URL, vanity name, or SteamID64",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    steamProfile: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used inside a server.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (action === "start") {
      const existing = await getActiveSteamCollectionImportForUser(interaction.user.id);
      if (existing) {
        await interaction.editReply(
          `You already have import #${existing.importId} (${existing.status}). ` +
          "Use action:resume, action:status, action:pause, or action:cancel.",
        );
        return;
      }

      const identifierInput = steamProfile
        ? sanitizeUserInput(steamProfile, { preserveNewlines: false }).trim()
        : "";
      let identifier = identifierInput;
      if (!identifier) {
        const memberRecord = await Member.getByUserId(interaction.user.id);
        identifier = memberRecord?.steamUrl?.trim() ?? "";
      }

      if (!identifier) {
        await interaction.editReply(
          "Provide steam_profile or add your Steam URL with `/profile edit steam:<url>` first.",
        );
        return;
      }

      try {
        const resolved = await steamApiService.resolveProfileIdentifier(identifier);
        const library = await steamApiService.getOwnedGames(resolved.steamId64);

        if (!library.games.length) {
          await interaction.editReply(
            "No Steam games were found. Ensure your profile and game details are public.",
          );
          return;
        }

        const session = await createSteamCollectionImportSession({
          userId: interaction.user.id,
          totalCount: library.games.length,
          steamId64: resolved.steamId64,
          steamProfileRef: identifier,
          sourceProfileName: library.profileName,
        });

        await insertSteamCollectionImportItems(
          session.importId,
          library.games.map((game, index) => ({
            rowIndex: index + 1,
            steamAppId: game.appId,
            steamAppName: game.name,
            playtimeForeverMin: game.playtimeForeverMinutes,
            playtimeWindowsMin: game.playtimeWindowsMinutes,
            playtimeMacMin: game.playtimeMacMinutes,
            playtimeLinuxMin: game.playtimeLinuxMinutes,
            playtimeDeckMin: game.playtimeDeckMinutes,
            lastPlayedAt: game.lastPlayedAt,
          })),
        );
        logSteamImportEvent("started", {
          userId: interaction.user.id,
          importId: session.importId,
          steamId64: resolved.steamId64,
          total: library.gameCount,
        });

        await interaction.editReply(
          `Steam import #${session.importId} created for **${library.gameCount}** games ` +
          `(${library.profileName ?? resolved.steamId64}). Starting review now.`,
        );
        await this.renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
      } catch (error: any) {
        logSteamImportEvent("start_failed", {
          userId: interaction.user.id,
          error: String(error?.message ?? "unknown"),
        });
        if (error instanceof SteamApiError) {
          await interaction.editReply(error.message);
          return;
        }
        await interaction.editReply(
          error?.message ?? "Failed to start Steam import. Verify profile and try again.",
        );
      }
      return;
    }

    const session = await getActiveSteamCollectionImportForUser(interaction.user.id);
    if (!session) {
      await interaction.editReply("No active Steam import session found.");
      return;
    }

    if (action === "status") {
      const stats = await countSteamCollectionImportItems(session.importId);
      const reasonCounts = await countSteamCollectionImportResultReasons(session.importId);
      const reasonLines = buildSteamImportReasonSummary(reasonCounts);
      const embed = new EmbedBuilder()
        .setTitle(`Steam Collection Import #${session.importId}`)
        .setDescription(`Status: ${session.status}`)
        .addFields(
          { name: "Pending", value: String(stats.pending), inline: true },
          { name: "Added", value: String(stats.added), inline: true },
          { name: "Updated", value: String(stats.updated), inline: true },
          { name: "Skipped", value: String(stats.skipped), inline: true },
          { name: "Failed", value: String(stats.failed), inline: true },
        );
      if (reasonLines.length) {
        embed.addFields({
          name: "Reason breakdown",
          value: reasonLines.join(" | ").slice(0, 1024),
        });
      }
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    let nextStatus: SteamCollectionImportStatus;
    if (action === "pause") {
      nextStatus = "PAUSED";
    } else if (action === "cancel") {
      nextStatus = "CANCELED";
    } else {
      nextStatus = "ACTIVE";
    }

    await setSteamCollectionImportStatus(session.importId, nextStatus);
    if (action === "pause") {
      const stats = await countSteamCollectionImportItems(session.importId);
      logSteamImportEvent("paused", {
        userId: interaction.user.id,
        importId: session.importId,
        pending: stats.pending,
      });
      await interaction.editReply(
        `Steam import #${session.importId} paused. ` +
        `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
        `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
      );
      return;
    }
    if (action === "cancel") {
      const stats = await countSteamCollectionImportItems(session.importId);
      logSteamImportEvent("canceled", {
        userId: interaction.user.id,
        importId: session.importId,
        pending: stats.pending,
      });
      await interaction.editReply(
        `Steam import #${session.importId} canceled. ` +
        `Pending ${stats.pending}, Added ${stats.added}, Updated ${stats.updated}, ` +
        `Skipped ${stats.skipped}, Failed ${stats.failed}.`,
      );
      return;
    }

    await interaction.editReply(
      `Steam import #${session.importId} resumed.`,
    );
    logSteamImportEvent("resumed", {
      userId: interaction.user.id,
      importId: session.importId,
    });
    await this.renderNextSteamImportItem(interaction, session.importId, interaction.user.id);
  }

  @ButtonComponent({
    id: /^collection-steam-import-v1:[^:]+:\d+:\d+:[srpi]$/,
  })
  async onSteamImportAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamImportActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId) {
      await safeUpdate(interaction, {
        content: null,
        components: [buildSteamImportTextContainer("This Steam import session no longer exists.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    if (session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildSteamImportTextContainer(
          `Steam import #${session.importId} is ${session.status.toLowerCase()}.`,
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "pause") {
      await setSteamCollectionImportStatus(session.importId, "PAUSED");
      await safeUpdate(interaction, {
        content: null,
        components: [buildSteamImportTextContainer(
          `Steam import #${session.importId} paused. ` +
          "Use `/collection import-steam action:resume` to continue.",
        )],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "skip") {
      await interaction.deferUpdate().catch(() => {});
      await updateSteamCollectionImportItem(item.itemId, {
        status: "SKIPPED",
        resultReason: "MANUAL_SKIP",
        errorText: "Skipped by user.",
      });
      logSteamImportEvent("item_skipped", {
        userId: parsed.ownerId,
        importId: session.importId,
        itemId: item.itemId,
        steamAppId: item.steamAppId,
      });
      await upsertSteamAppGameDbMap({
        steamAppId: item.steamAppId,
        gameDbGameId: null,
        status: "SKIPPED",
        createdBy: parsed.ownerId,
      });
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    if (parsed.action === "remap") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamRemapModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import remap");

      const remapInput = new TextInputBuilder()
        .setCustomId(COLLECTION_STEAM_REMAP_INPUT_ID)
        .setLabel("Search title")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
        .setValue(item.steamAppName.slice(0, 120))
        .setPlaceholder("Call of Duty Classic");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(remapInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    if (parsed.action === "game-id") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionSteamGameIdModalId({
            ownerId: parsed.ownerId,
            importId: session.importId,
            itemId: item.itemId,
          }),
        )
        .setTitle("Steam import: Enter GameDB ID");

      const gameIdInput = new TextInputBuilder()
        .setCustomId(COLLECTION_STEAM_GAME_ID_INPUT_ID)
        .setLabel("GameDB ID (or IGDB numeric ID)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder("12345");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(gameIdInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }
  }

  @ButtonComponent({
    id: /^collection-steam-choose-v1:[^:]+:\d+:\d+:\d+$/,
  })
  async onSteamImportChoose(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionSteamChooseButtonId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This Steam import choice is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This Steam import choice is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await safeUpdate(interaction, {
        content: null,
        components: [buildSteamImportTextContainer("This Steam import session is no longer active.")],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await interaction.deferUpdate().catch(() => {});
      await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: parsed.gameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: parsed.gameId,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-remap-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportRemapModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamRemapModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This remap form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This remap form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_STEAM_REMAP_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 120 },
    );
    const remapTitle = gameIdRaw.trim();
    if (!remapTitle) {
      await updateSteamCollectionImportItem(item.itemId, {
        resultReason: "INVALID_REMAP",
      });
      await safeUpdate(interaction, {
        content: "Enter a title to search for remap.",
        components: [],
      });
      return;
    }

    const remapCandidates = await buildSteamImportCandidates(remapTitle);
    if (!remapCandidates.length) {
      await updateSteamCollectionImportItem(item.itemId, {
        matchCandidateJson: null,
        matchConfidence: null,
        resultReason: "NO_CANDIDATE",
        errorText: `No candidates found for remap search "${remapTitle}".`,
      });
      await safeUpdate(interaction, {
        content:
          `No GameDB matches found for "${remapTitle}". ` +
          "Use Search a different title to try another title or Skip.",
        components: [buildSteamImportItemButtons({
          ownerId: parsed.ownerId,
          importId: session.importId,
          itemId: item.itemId,
        })],
      });
      return;
    }

    const remapMatchConfidence = buildSteamImportMatchConfidence(remapTitle, remapCandidates);
    await updateSteamCollectionImportItem(item.itemId, {
      matchCandidateJson: JSON.stringify(remapCandidates),
      matchConfidence: remapMatchConfidence,
      resultReason: null,
      errorText: null,
    });
    logSteamImportEvent("item_remapped", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      candidateCount: remapCandidates.length,
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @ModalComponent({
    id: /^collection-steam-game-id-v1:[^:]+:\d+:\d+$/,
  })
  async onSteamImportGameIdModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionSteamGameIdModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This GameDB ID form is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.ownerId) {
      await interaction.reply({
        content: "This GameDB ID form is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const session = await getSteamCollectionImportById(parsed.importId);
    if (!session || session.userId !== parsed.ownerId || session.status !== "ACTIVE") {
      await interaction.reply({
        content: "This Steam import session is no longer active.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const item = await getNextPendingSteamCollectionImportItem(session.importId);
    if (!item || item.itemId !== parsed.itemId) {
      await safeUpdate(interaction, {
        content: "This import row is no longer pending.",
        components: [],
      });
      return;
    }

    const gameIdRaw = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_STEAM_GAME_ID_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 20 },
    ).trim();
    const enteredId = Number(gameIdRaw);
    if (!Number.isInteger(enteredId) || enteredId <= 0) {
      await safeUpdate(interaction, {
        content: "Game ID must be a positive integer.",
        components: [],
      });
      return;
    }

    let resolvedGameId: number | null = null;
    let source: "gamedb" | "igdb" | null = null;

    const game = await Game.getGameById(enteredId);
    if (game) {
      resolvedGameId = game.id;
      source = "gamedb";
    } else {
      try {
        const imported = await Game.importGameFromIgdb(enteredId);
        resolvedGameId = imported.gameId;
        source = "igdb";
      } catch {
        resolvedGameId = null;
      }
    }

    if (!resolvedGameId) {
      await safeUpdate(interaction, {
        content: `Could not find or import game ID ${enteredId}.`,
        components: [],
      });
      return;
    }

    await this.applySteamImportSelection({
      ownerId: parsed.ownerId,
      gameId: resolvedGameId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      reason: "MANUAL_REMAP",
    });
    logSteamImportEvent("item_selected_by_game_id", {
      userId: parsed.ownerId,
      importId: session.importId,
      itemId: item.itemId,
      steamAppId: item.steamAppId,
      gameDbGameId: resolvedGameId,
      source: source ?? "unknown",
    });

    await this.renderNextSteamImportItem(interaction, session.importId, parsed.ownerId);
  }

  @Slash({ name: "add", description: "Add a game you own to your collection" })
  async add(
    @SlashOption({
      name: "title",
      description: "Game title from GameDB",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionGameTitle,
    })
    gameIdRaw: string,
    @SlashOption({
      name: "platform",
      description: "Owned platform",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Ownership metadata",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    ownershipType: CollectionOwnershipType,
    @SlashOption({
      name: "note",
      description: "Optional note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const platformId = await resolveGameCompletionPlatformId(platformRaw);
    if (!platformId) {
      await interaction.editReply("Invalid platform selection.");
      return;
    }

    const sanitizedNote = note
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 })
      : null;

    let resolution: ResolvedCollectionGame;
    try {
      resolution = await resolveCollectionGameForAdd(gameIdRaw);
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Invalid game selection.");
      return;
    }

    if (resolution.kind === "choose") {
      const { components } = createIgdbSession(
        interaction.user.id,
        resolution.options,
        async (selectionInteraction, igdbId) => {
          try {
            const imported = await Game.importGameFromIgdb(igdbId);
            const created = await UserGameCollection.addEntry({
              userId: interaction.user.id,
              gameId: imported.gameId,
              platformId,
              ownershipType,
              note: sanitizedNote,
            });

            const platformLabel = created.platformName ?? `Platform #${platformId}`;
            await selectionInteraction.followUp({
              content:
                `Imported and added **${created.title}** (${platformLabel}, ` +
                `${created.ownershipType}) to your collection.`,
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          } catch (err: any) {
            await selectionInteraction.followUp({
              content: err?.message ?? "Failed to import from IGDB and add collection entry.",
              flags: MessageFlags.Ephemeral,
            }).catch(() => {});
          }
        },
      );

      await interaction.editReply({
        content:
          `No exact GameDB match found for "${resolution.titleQuery}". ` +
          "Select the correct IGDB game to import:",
        components,
      });
      return;
    }

    const resolvedGame = resolution;

    try {
      const created = await UserGameCollection.addEntry({
        userId: interaction.user.id,
        gameId: resolvedGame.gameId,
        platformId,
        ownershipType,
        note: sanitizedNote,
      });

      const platformLabel = created.platformName ?? `Platform #${platformId}`;
      await interaction.editReply(
        `Added **${created.title}** (${platformLabel}, ${created.ownershipType}) ` +
        `to your collection.`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add collection entry.");
    }
  }

  @Slash({ name: "list", description: "List your collection or another member collection" })
  async list(
    @SlashOption({
      name: "member",
      description: "Member whose collection to view",
      type: ApplicationCommandOptionType.User,
      required: false,
    })
    member: User | undefined,
    @SlashOption({
      name: "title",
      description: "Filter by title",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    title: string | undefined,
    @SlashOption({
      name: "platform",
      description: "Filter by platform text",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    platform: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "Filter by ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, show results in channel instead of private response.",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isEphemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(isEphemeral) });

    const targetUserId = member?.id ?? interaction.user.id;
    const titleFilter = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : undefined;
    const platformFilter = platform
      ? sanitizeUserInput(platform, { preserveNewlines: false })
      : undefined;

    const memberLabel = member?.username ?? interaction.user.username;
    const response = await buildCollectionListResponse({
      viewerUserId: interaction.user.id,
      targetUserId,
      memberLabel,
      title: titleFilter,
      platform: platformFilter,
      ownershipType,
      page: 0,
      isEphemeral,
    });

    if (response.content) {
      await interaction.editReply(response.content);
      return;
    }
    await interaction.editReply({
      components: response.components,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  @ButtonComponent({
    id: /^collection-list-nav-v2:[^:]+:[^:]+:\d+:[ep]:(prev|next)$/,
  })
  async onCollectionListNav(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionListNavId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This collection view control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const nextPage = parsed.direction === "next"
      ? parsed.page + 1
      : Math.max(parsed.page - 1, 0);
    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel: "Member",
      title: currentFilters.title,
      platform: currentFilters.platform,
      ownershipType: currentFilters.ownershipType,
      page: nextPage,
      isEphemeral: parsed.isEphemeral,
    });

    if (response.content) {
      await safeUpdate(interaction, {
        content: response.content,
        components: [],
      });
      return;
    }

    await safeUpdate(interaction, {
      components: response.components,
      flags: buildComponentsV2Flags(parsed.isEphemeral),
    });
  }

  @ButtonComponent({
    id: /^collection-list-filter-v1:[^:]+:[^:]+:[ep]:open$/,
  })
  async onCollectionFilterOpen(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterActionId(interaction.customId);
    if (!parsed || parsed.action !== "open") {
      await interaction.reply({
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This collection view is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const currentFilters = parseCollectionFiltersFromListMessage(interaction.message);

    await interaction.reply({
      content: buildCollectionFilterPanelContent({
        title: currentFilters.title,
        platform: currentFilters.platform,
        ownershipType: currentFilters.ownershipType,
      }),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: interaction.message.id,
        isEphemeral: parsed.isEphemeral,
        ownershipType: currentFilters.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  @ButtonComponent({
    id: /^clf1:[^:]+:[^:]+:[^:]+:[ep]:[toacx]$/,
  })
  async onCollectionFilterAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseCollectionFilterPanelActionId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This filter control is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This filter control is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (parsed.action === "cancel") {
      await closeFilterPanel(interaction);
      return;
    }

    const currentState = parseCollectionFilterStateFromContent(interaction.message.content ?? "");

    if (parsed.action === "text") {
      const modal = new ModalBuilder()
        .setCustomId(
          buildCollectionFilterModalId({
            viewerUserId: parsed.viewerUserId,
            targetUserId: parsed.targetUserId,
            sourceMessageId: parsed.sourceMessageId,
            isEphemeral: parsed.isEphemeral,
            ownershipCode: ownershipTypeToCode(currentState.ownershipType),
          }),
        )
        .setTitle("Collection filters");

      const titleInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_TITLE_INPUT_ID)
        .setLabel("Title contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.title ?? "");
      const platformInput = new TextInputBuilder()
        .setCustomId(COLLECTION_FILTER_PLATFORM_INPUT_ID)
        .setLabel("Platform contains")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setValue(currentState.platform ?? "");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(platformInput),
      );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    const nextState = parsed.action === "clear"
      ? {
        title: undefined,
        platform: undefined,
        ownershipType: undefined,
      }
      : parsed.action === "ownership"
        ? {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: nextOwnershipType(currentState.ownershipType),
        }
        : {
          title: currentState.title,
          platform: currentState.platform,
          ownershipType: currentState.ownershipType,
        };

    if (parsed.action === "apply") {
      await interaction.deferUpdate().catch(() => {});
      const applied = await applyFiltersToSourceMessage({
        interaction,
        sourceMessageId: parsed.sourceMessageId,
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        isEphemeral: parsed.isEphemeral,
        title: nextState.title,
        platform: nextState.platform,
        ownershipType: nextState.ownershipType,
      });
      await (interaction.message as any)?.delete?.().catch(() => {});
      if (!applied) {
        await interaction.followUp({
          content: "Could not update that collection message.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }
      return;
    }

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({
    id: /^clfm1:[^:]+:[^:]+:[^:]+:[ep]:[^:]+$/,
  })
  async onCollectionFilterTextModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseCollectionFilterModalId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This filter modal is invalid.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== parsed.viewerUserId) {
      await interaction.reply({
        content: "This filter modal is not for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const titleInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_TITLE_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );
    const platformInput = sanitizeUserInput(
      interaction.fields.getTextInputValue(COLLECTION_FILTER_PLATFORM_INPUT_ID) ?? "",
      { preserveNewlines: false, maxLength: 100 },
    );

    const nextState = {
      title: titleInput || undefined,
      platform: platformInput || undefined,
      ownershipType: parsed.ownershipType,
    };

    await safeUpdate(interaction, {
      content: buildCollectionFilterPanelContent(nextState),
      components: buildCollectionFilterPanelComponents({
        viewerUserId: parsed.viewerUserId,
        targetUserId: parsed.targetUserId,
        sourceMessageId: parsed.sourceMessageId,
        isEphemeral: parsed.isEphemeral,
        ownershipType: nextState.ownershipType,
      }),
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ name: "edit", description: "Edit one of your collection entries" })
  async edit(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "platform",
      description: "New platform",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: autocompleteGameCompletionPlatformStandardFirst,
    })
    platformRaw: string | undefined,
    @SlashChoice(
      ...COLLECTION_OWNERSHIP_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "ownership_type",
      description: "New ownership type",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    ownershipType: CollectionOwnershipType | undefined,
    @SlashOption({
      name: "note",
      description: "New note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "clear_note",
      description: "Clear note",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    clearNote: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const updates: {
      platformId?: number | null;
      ownershipType?: CollectionOwnershipType;
      note?: string | null;
    } = {};

    if (platformRaw !== undefined) {
      const platformId = await resolveGameCompletionPlatformId(platformRaw);
      if (!platformId) {
        await interaction.editReply("Invalid platform selection.");
        return;
      }
      updates.platformId = platformId;
    }

    if (ownershipType !== undefined) {
      updates.ownershipType = ownershipType;
    }

    if (clearNote) {
      updates.note = null;
    } else if (note !== undefined) {
      updates.note = sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 });
    }

    if (!Object.keys(updates).length) {
      await interaction.editReply("Provide at least one field to update.");
      return;
    }

    try {
      const updated = await UserGameCollection.updateEntryForUser(
        entryId,
        interaction.user.id,
        updates,
      );
      if (!updated) {
        await interaction.editReply("Collection entry was not found.");
        return;
      }

      const platformLabel = updated.platformName ?? "Unknown platform";
      await interaction.editReply(
        `Updated **${updated.title}** (${platformLabel}, ${updated.ownershipType}).`,
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to update collection entry.");
    }
  }

  @Slash({ name: "remove", description: "Remove one of your collection entries" })
  async remove(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const existing = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!existing) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const deleted = await UserGameCollection.removeEntryForUser(entryId, interaction.user.id);
    if (!deleted) {
      await interaction.editReply("Failed to remove that collection entry.");
      return;
    }

    await interaction.editReply(`Removed **${existing.title}** from your collection.`);
  }

  @Slash({ name: "to-now-playing", description: "Add a collection entry to your now-playing list" })
  async toNowPlaying(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashOption({
      name: "note_override",
      description: "Override note for now-playing",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    noteOverride: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    if (!entry.platformId) {
      await interaction.editReply("This entry does not have a platform. Update it before adding.");
      return;
    }

    const note = noteOverride !== undefined
      ? sanitizeUserInput(noteOverride, { preserveNewlines: true, maxLength: 500 })
      : entry.note;

    try {
      await Member.addNowPlaying(interaction.user.id, entry.gameId, entry.platformId, note);
      await interaction.editReply(
        `Added **${entry.title}** (${entry.platformName ?? "Unknown platform"}) ` +
        "to your now-playing list.",
      );
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Failed to add entry to now-playing.");
    }
  }

  @Slash({ name: "to-completion", description: "Log a completion from a collection entry" })
  async toCompletion(
    @SlashOption({
      name: "entry",
      description: "Collection entry",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: autocompleteCollectionEntry,
    })
    entryRaw: string,
    @SlashChoice(
      ...COMPLETION_TYPES.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      name: "completion_type",
      description: "Type of completion",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    completionType: CompletionType,
    @SlashOption({
      name: "completion_date",
      description: "YYYY-MM-DD, today, or unknown",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    completionDateRaw: string | undefined,
    @SlashOption({
      name: "final_playtime_hours",
      description: "Playtime in hours",
      type: ApplicationCommandOptionType.Number,
      required: false,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      name: "note",
      description: "Optional completion note",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    note: string | undefined,
    @SlashOption({
      name: "announce",
      description: "Announce completion",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    announce: boolean | undefined,
    @SlashOption({
      name: "remove_from_now_playing",
      description: "Remove game from now-playing",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    removeFromNowPlaying: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const entryId = parseCollectionEntryAutocompleteValue(entryRaw);
    if (!entryId) {
      await interaction.editReply("Invalid collection entry selection.");
      return;
    }

    const entry = await UserGameCollection.getEntryForUser(entryId, interaction.user.id);
    if (!entry) {
      await interaction.editReply("Collection entry was not found.");
      return;
    }

    const completionDateInput = completionDateRaw
      ? sanitizeUserInput(completionDateRaw, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(completionDateInput);
    } catch (err: any) {
      await interaction.editReply(err?.message ?? "Invalid completion date.");
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await interaction.editReply("Final playtime must be a non-negative number.");
      return;
    }

    const completionNote = note !== undefined
      ? sanitizeUserInput(note, { preserveNewlines: true, maxLength: 500 }) || null
      : entry.note;

    await saveCompletion(
      interaction,
      interaction.user.id,
      entry.gameId,
      entry.platformId,
      completionType,
      completedAt,
      finalPlaytimeHours ?? null,
      completionNote,
      entry.title,
      announce,
      false,
      removeFromNowPlaying ?? true,
    );
  }
}
