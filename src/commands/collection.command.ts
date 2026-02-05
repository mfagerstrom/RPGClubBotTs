import {
  ApplicationCommandOptionType,
  AutocompleteInteraction,
  ButtonStyle,
  CommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  type User,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
  ButtonComponent,
  SelectMenuComponent,
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
import { GameDb } from "./gamedb.command.js";

const COLLECTION_ENTRY_VALUE_PREFIX = "collection";
const COLLECTION_LIST_PAGE_SIZE = 5;
const COLLECTION_LIST_NAV_PREFIX = "collection-list-nav-v2";
const COLLECTION_LIST_DETAILS_PREFIX = "collection-list-details-v1";
const COLLECTION_MAX_SECTIONS_PER_CONTAINER = 10;

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

function packFilterValue(value: string | undefined): string {
  if (!value) return "_";
  const trimmed = value.trim();
  if (!trimmed) return "_";
  return Buffer.from(trimmed.slice(0, 8), "utf8").toString("base64url");
}

function unpackFilterValue(value: string): string | undefined {
  if (!value || value === "_") return undefined;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8").trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
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

function buildCollectionListNavId(params: {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  ownershipCode: string;
  packedTitle: string;
  packedPlatform: string;
  direction: "prev" | "next";
}): string {
  return [
    COLLECTION_LIST_NAV_PREFIX,
    params.viewerUserId,
    params.targetUserId,
    String(params.page),
    params.isEphemeral ? "e" : "p",
    params.ownershipCode,
    params.packedTitle,
    params.packedPlatform,
    params.direction,
  ].join(":");
}

function parseCollectionListNavId(customId: string): {
  viewerUserId: string;
  targetUserId: string;
  page: number;
  isEphemeral: boolean;
  ownershipType: CollectionOwnershipType | undefined;
  title: string | undefined;
  platform: string | undefined;
  direction: "prev" | "next";
} | null {
  const parts = customId.split(":");
  if (parts.length !== 9) return null;
  if (parts[0] !== COLLECTION_LIST_NAV_PREFIX) return null;

  const viewerUserId = parts[1];
  const targetUserId = parts[2];
  const page = Number(parts[3]);
  const visibility = parts[4];
  const ownershipType = ownershipCodeToType(parts[5]);
  const title = unpackFilterValue(parts[6]);
  const platform = unpackFilterValue(parts[7]);
  const direction = parts[8] as "prev" | "next";
  if (!Number.isInteger(page) || page < 0) return null;
  if (visibility !== "e" && visibility !== "p") return null;
  if (direction !== "prev" && direction !== "next") return null;

  return {
    viewerUserId,
    targetUserId,
    page,
    isEphemeral: visibility === "e",
    ownershipType,
    title,
    platform,
    direction,
  };
}

function buildCollectionDetailsSelectId(viewerUserId: string): string {
  return `${COLLECTION_LIST_DETAILS_PREFIX}:${viewerUserId}`;
}

function buildCollectionDetailsValue(entryId: number, gameId: number): string {
  return `entry:${entryId}:game:${gameId}`;
}

function parseCollectionDetailsValue(value: string): { entryId: number; gameId: number } | null {
  const match = /^entry:(\d+):game:(\d+)$/.exec(value.trim());
  if (!match) return null;
  const entryId = Number(match[1]);
  const gameId = Number(match[2]);
  if (!Number.isInteger(entryId) || entryId <= 0) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;
  return { entryId, gameId };
}

function parseCollectionDetailsSelectId(customId: string): { viewerUserId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 2) return null;
  if (parts[0] !== COLLECTION_LIST_DETAILS_PREFIX) return null;
  return { viewerUserId: parts[1] };
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

  const headerContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${headerTitle}`),
  );
  headerContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Page ${safePage + 1}/${pageCount} • ${total} total entries`),
  );
  if (filtersText) {
    headerContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Filters**\n> ${filtersText}`),
    );
  }
  components.push(headerContainer);

  let contentContainer = new ContainerBuilder();
  let sectionCount = 0;
  for (const entry of pageEntries) {
    if (sectionCount >= COLLECTION_MAX_SECTIONS_PER_CONTAINER) {
      components.push(contentContainer);
      contentContainer = new ContainerBuilder();
      sectionCount = 0;
    }

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
    sectionCount += 1;
  }
  components.push(contentContainer);

  const detailsSelect = new StringSelectMenuBuilder()
    .setCustomId(buildCollectionDetailsSelectId(params.viewerUserId))
    .setPlaceholder("View a game's details...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      pageEntries.map((entry) => ({
        label: entry.title.slice(0, 100),
        value: buildCollectionDetailsValue(entry.entryId, entry.gameId),
        description: `${entry.platformName ?? "Unknown"} • ${entry.ownershipType}`.slice(0, 100),
      })),
    );
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(detailsSelect));

  if (pageCount > 1) {
    const packedTitle = packFilterValue(params.title);
    const packedPlatform = packFilterValue(params.platform);
    const ownershipCode = ownershipTypeToCode(params.ownershipType);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          buildCollectionListNavId({
            viewerUserId: params.viewerUserId,
            targetUserId: params.targetUserId,
            page: safePage,
            isEphemeral: params.isEphemeral,
            ownershipCode,
            packedTitle,
            packedPlatform,
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
            ownershipCode,
            packedTitle,
            packedPlatform,
            direction: "next",
          }),
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= pageCount - 1),
    );
    components.push(row);
  }

  return { components };
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
    id: /^collection-list-nav-v2:[^:]+:[^:]+:\d+:[ep]:[^:]+:[^:]+:[^:]+:(prev|next)$/,
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

    const response = await buildCollectionListResponse({
      viewerUserId: parsed.viewerUserId,
      targetUserId: parsed.targetUserId,
      memberLabel: "Member",
      title: parsed.title,
      platform: parsed.platform,
      ownershipType: parsed.ownershipType,
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

  @SelectMenuComponent({ id: /^collection-list-details-v1:[^:]+$/ })
  async onCollectionDetailsSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseCollectionDetailsSelectId(interaction.customId);
    if (!parsed) {
      await interaction.reply({
        content: "This collection details selector is invalid.",
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

    const parsedValue = parseCollectionDetailsValue(interaction.values?.[0] ?? "");
    if (!parsedValue) {
      await interaction.reply({
        content: "Invalid GameDB id.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const gameDb = new GameDb();
    await gameDb.showGameProfileFromNomination(interaction, parsedValue.gameId);
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
