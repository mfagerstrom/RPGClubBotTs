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
  TextInputBuilder,
  TextInputStyle,
  type User,
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
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import UserGameCollection, {
  COLLECTION_OWNERSHIP_TYPES,
  type CollectionOwnershipType,
} from "../classes/UserGameCollection.js";
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
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const COLLECTION_ENTRY_VALUE_PREFIX = "collection";
const COLLECTION_LIST_PAGE_SIZE = 10;
const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
const COLLECTION_LIST_FILTER_PREFIX = "collection-list-filter-v1";
const COLLECTION_LIST_FILTER_PANEL_PREFIX = "clf1";
const COLLECTION_LIST_FILTER_MODAL_PREFIX = "clfm1";
const COLLECTION_FILTER_TITLE_INPUT_ID = "collection-filter-title";
const COLLECTION_FILTER_PLATFORM_INPUT_ID = "collection-filter-platform";

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

type ResolvedCollectionGame =
  | { kind: "resolved"; gameId: number; title: string }
  | { kind: "choose"; titleQuery: string; options: IgdbSelectOption[] };

function buildCollectionIgdbSelectOptions(results: IGDBGame[]): IgdbSelectOption[] {
  return results.slice(0, 50).map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    const summary = (game.summary ?? "No summary").replace(/\s+/g, " ").trim();
    return {
      id: game.id,
      label: `${game.name} (${year})`.slice(0, 100),
      description: summary.slice(0, 95),
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
    options: buildCollectionIgdbSelectOptions(igdbSearch.results),
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
          await selectionInteraction.deferUpdate().catch(() => {});
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
