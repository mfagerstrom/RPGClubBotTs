import {
  ApplicationCommandOptionType,
  type Attachment,
  AutocompleteInteraction,
  type CommandInteraction,
  EmbedBuilder,
  ComponentType,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Message,
  type ThreadChannel,
  AttachmentBuilder,
  type User,
  type ModalSubmitInteraction,
  type InteractionReplyOptions,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import axios from "axios";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
  SelectMenuComponent,
  ButtonComponent,
  SlashChoice,
  ModalComponent,
} from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game from "../classes/Game.js";
import { STANDARD_PLATFORM_IDS } from "../config/standardPlatforms.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";
import { GAMEDB_CSV_PLATFORM_MAP } from "../config/gamedbCsvPlatformMap.js";
import { igdbService } from "../services/IgdbService.js";
import {
  createImportSession,
  insertImportItems,
  getActiveImportForUser,
  getImportById,
  getImportItemById,
  setImportStatus,
  getNextPendingItem,
  updateImportItem,
  updateImportIndex,
  countImportItems,
  type ICompletionatorImport,
  type ICompletionatorItem,
} from "../classes/CompletionatorImport.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  COMPLETION_PAGE_SIZE,
  formatDiscordTimestamp,
  formatPlaytimeHours,
  parseCompletionDateInput,
  formatTableDate,
} from "./profile.command.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import {
  notifyUnknownCompletionPlatform,
  promptRemoveFromNowPlaying,
  saveCompletion,
} from "../functions/CompletionHelpers.js";
import { buildComponentsV2Flags } from "../functions/NominationListComponents.js";

type CompletionAddContext = {
  userId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  source: "existing" | "igdb";
  query?: string;
  announce?: boolean;
};

const completionAddSessions = new Map<string, CompletionAddContext>();
type CompletionPlatformContext = {
  userId: string;
  gameId: number;
  gameTitle: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  note: string | null;
  announce?: boolean;
  removeFromNowPlaying: boolean;
  platforms: Array<{ id: number; name: string }>;
};
const completionPlatformSessions = new Map<string, CompletionPlatformContext>();
const COMPLETION_PLATFORM_SELECT_PREFIX = "completion-platform-select";
const COMPLETIONATOR_SKIP_SENTINEL = "skip";
const COMPLETIONATOR_STATUS_OPTIONS = ["start", "resume", "status", "pause", "cancel"] as const;

function shouldPromptNowPlayingRemoval(
  addedAt: Date | null,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): boolean {
  if (!addedAt) return true;
  if (!requireCompletionAfterAdded) return true;
  if (!completedAt) return true;
  return completedAt >= addedAt;
}

async function resolveNowPlayingRemoval(
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  userId: string,
  gameId: number,
  gameTitle: string,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): Promise<boolean> {
  const nowPlayingMeta = await Member.getNowPlayingEntryMeta(userId, gameId);
  if (!nowPlayingMeta) {
    return false;
  }
  const shouldPrompt = shouldPromptNowPlayingRemoval(
    nowPlayingMeta.addedAt,
    completedAt,
    requireCompletionAfterAdded,
  );
  if (!shouldPrompt) {
    return false;
  }
  return promptRemoveFromNowPlaying(interaction, gameTitle);
}

type CompletionatorAction = (typeof COMPLETIONATOR_STATUS_OPTIONS)[number];
type CompletionatorThreadContext = {
  userId: string;
  importId: number;
  threadId: string;
  messageId: string;
  thread: ThreadChannel | null;
  message: Message;
  parentMessage: Message | null;
};

const completionatorThreadContexts: Map<string, CompletionatorThreadContext> = new Map();

const COMPLETIONATOR_MATCH_THUMBNAIL_NAME = "completionator_match.png";

type CompletionatorDateChoice = "csv" | "today" | "unknown" | "date";
type CompletionatorAddFormState = {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
  completionType: CompletionType;
  dateChoice: CompletionatorDateChoice;
  customDate: Date | null;
  platformId: number | null;
  otherPlatform: boolean;
};

const completionatorAddFormStates = new Map<string, CompletionatorAddFormState>();

type CompletionatorModalKind =
  | "gamedb-query"
  | "igdb-query"
  | "gamedb-manual"
  | "igdb-manual";

function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, 100),
    value: query,
  };
}

async function autocompleteGameCompletionTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  if (interaction.options.getSubcommand() !== "add") {
    await interaction.respond([]);
    return;
  }
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGames(query);
  const resultOptions = results.slice(0, 24).map((game) => ({
    name: game.title.slice(0, 100),
    value: game.title,
  }));
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

@Discord()
@SlashGroup({ description: "Manage game completions", name: "game-completion" })
@SlashGroup("game-completion")
export class GameCompletionCommands {
  private readonly maxNoteLength = 500;

  @Slash({ description: "Add a game completion", name: "add" })
  async completionAdd(
    @SlashOption({
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteGameCompletionTitle,
    })
    query: string,
    @SlashChoice(
      ...COMPLETION_TYPES.map((t) => ({
        name: t,
        value: t,
      })),
    )
    @SlashOption({
      description: "Type of completion",
      name: "completion_type",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    completionType: CompletionType,
    @SlashOption({
      description: "Optional note for this completion",
      name: "note",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    note: string | undefined,
    @SlashOption({
      description: "Completion date (YYYY-MM-DD, today, or unknown)",
      name: "completion_date",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionDate: string | undefined,
    @SlashOption({
      description: "Final playtime in hours (e.g., 12.5)",
      name: "final_playtime_hours",
      required: false,
      type: ApplicationCommandOptionType.Number,
    })
    finalPlaytimeHours: number | undefined,
    @SlashOption({
      description: "Announce this completion in the completions channel?",
      name: "announce",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    announce: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (!COMPLETION_TYPES.includes(completionType)) {
      await safeReply(interaction, {
        content: "Invalid completion type.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    query = sanitizeUserInput(query, { preserveNewlines: false });
    note = note ? sanitizeUserInput(note, { preserveNewlines: true }) : undefined;
    completionDate = completionDate
      ? sanitizeUserInput(completionDate, { preserveNewlines: false })
      : undefined;

    let completedAt: Date | null;
    try {
      completedAt = parseCompletionDateInput(completionDate);
    } catch (err: any) {
      await safeReply(interaction, {
        content: err?.message ?? "Invalid completion date.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      finalPlaytimeHours !== undefined &&
      (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)
    ) {
      await safeReply(interaction, {
        content: "Final playtime must be a non-negative number of hours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const playtime = finalPlaytimeHours === undefined ? null : finalPlaytimeHours;
    const userId = interaction.user.id;
    const trimmedNote = note?.trim() ?? null;
    if (trimmedNote && trimmedNote.length > this.maxNoteLength) {
      await safeReply(interaction, {
        content: `Note must be ${this.maxNoteLength} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const searchTerm = query.trim();
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Provide a game title to search.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const localResults = await Game.searchGames(searchTerm);
    const exactMatch = localResults.find(
      (game) => game.title.toLowerCase() === searchTerm.toLowerCase(),
    );
    if (exactMatch) {
      const referenceDate = completedAt ?? new Date();
      const recent = await Member.getRecentCompletionForGame(
        userId,
        exactMatch.id,
        referenceDate,
      );
      if (recent) {
        const confirmed = await this.confirmDuplicateCompletion(
          interaction,
          exactMatch.title,
          recent,
        );
        if (!confirmed) {
          return;
        }
      }
      const removeFromNowPlaying = await resolveNowPlayingRemoval(
        interaction,
        userId,
        exactMatch.id,
        exactMatch.title,
        completedAt,
        false,
      );
      await this.promptCompletionPlatformSelection(interaction, {
        userId,
        gameId: exactMatch.id,
        gameTitle: exactMatch.title,
        completionType,
        completedAt,
        finalPlaytimeHours: playtime,
        note: trimmedNote,
        announce,
        removeFromNowPlaying,
      });
      return;
    }

    const sessionId = this.createCompletionSession({
      userId,
      completionType,
      completedAt,
      finalPlaytimeHours: playtime,
      note: trimmedNote,
      source: "existing",
      query: searchTerm,
      announce,
    });
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`completion-add-igdb-confirm:${sessionId}:yes`)
        .setLabel("Yes, import from IGDB")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`completion-add-igdb-confirm:${sessionId}:cancel`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );
    await safeReply(interaction, {
      content:
        `No exact GameDB match found for "${searchTerm}". ` +
        "Import it from IGDB.com?",
      components: [confirmRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^completion-add-igdb-confirm:.+/ })
  async handleCompletionAddIgdbConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, action] = interaction.customId.split(":");
    const ctx = completionAddSessions.get(sessionId);
    if (!ctx) {
      await interaction.reply({
        content: "This completion prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.user.id !== ctx.userId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action !== "yes") {
      completionAddSessions.delete(sessionId);
      await interaction.update({
        content: "Cancelled.",
        components: [],
      });
      return;
    }

    if (!ctx.query) {
      completionAddSessions.delete(sessionId);
      await interaction.update({
        content: "Search query missing. Please try again.",
        components: [],
      });
      return;
    }

    try {
      await this.promptIgdbSelection(interaction, ctx.query, ctx);
    } finally {
      completionAddSessions.delete(sessionId);
    }
  }

  @Slash({ description: "List your completed games", name: "list" })
  async completionList(
    @SlashOption({
      description: "Show a leaderboard of all members with completions.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    @SlashOption({
      description: "Filter by year or 'unknown' (optional)",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    yearRaw: string | undefined,
    @SlashOption({
      description: "Filter by title (optional)",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "If true, show in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const sanitizedQuery = query
      ? sanitizeUserInput(query, { preserveNewlines: false })
      : undefined;
    const sanitizedYearRaw = yearRaw
      ? sanitizeUserInput(yearRaw, { preserveNewlines: false })
      : undefined;

    if (showAll) {
      await this.renderCompletionLeaderboard(interaction, ephemeral, sanitizedQuery);
      return;
    }

    let yearFilter: number | "unknown" | null = null;
    if (sanitizedYearRaw) {
      const trimmed = sanitizedYearRaw.trim();
      if (trimmed.toLowerCase() === "unknown") {
        yearFilter = "unknown";
      } else {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          await safeReply(interaction, {
            content: "Year must be a valid integer (e.g., 2024) or 'unknown'.",
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
          });
          return;
        }
        yearFilter = parsed;
      }
    }

    const targetUserId = member ? member.id : interaction.user.id;
    await this.renderCompletionPage(
      interaction,
      targetUserId,
      0,
      yearFilter,
      ephemeral,
      sanitizedQuery,
    );
  }


  @Slash({ description: "Edit one of your completion records", name: "edit" })
  async completionEdit(
    @SlashOption({
      description: "Filter by title (optional)",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: "Filter by year (optional)",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const sanitizedQuery = query
      ? sanitizeUserInput(query, { preserveNewlines: false })
      : undefined;
    await this.renderSelectionPage(
      interaction,
      interaction.user.id,
      0,
      "edit",
      year ?? null,
      sanitizedQuery,
    );
  }

  @Slash({ description: "Delete one of your completion records", name: "delete" })
  async completionDelete(
    @SlashOption({
      description: "Filter by title (optional)",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const sanitizedQuery = query
      ? sanitizeUserInput(query, { preserveNewlines: false })
      : undefined;
    await this.renderSelectionPage(
      interaction,
      interaction.user.id,
      0,
      "delete",
      null,
      sanitizedQuery,
    );
  }

  @Slash({ description: "Export your completions to a CSV file", name: "export" })
  async completionExport(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const completions = await Member.getAllCompletions(interaction.user.id);
    if (!completions.length) {
      await safeReply(interaction, {
        content: "You have no completions to export.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const headers = [
      "ID",
      "Game ID",
      "Title",
      "Type",
      "Platform ID",
      "Completed Date",
      "Playtime (Hours)",
      "Note",
      "Created At",
    ];
    const rows = completions.map((c) => {
      return [
        String(c.completionId),
        String(c.gameId),
        c.title,
        c.completionType,
        c.platformId != null ? String(c.platformId) : "",
        c.completedAt ? c.completedAt.toISOString().split("T")[0] : "",
        c.finalPlaytimeHours != null ? String(c.finalPlaytimeHours) : "",
        c.note ?? "",
        c.createdAt.toISOString(),
      ].map(escapeCsv).join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const buffer = Buffer.from(csvContent, "utf-8");
    const attachment = new AttachmentBuilder(buffer, { name: "completions.csv" });

    await safeReply(interaction, {
      content: `Here is your completion data export (${completions.length} records).`,
      files: [attachment],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^comp-import-select:\d+:\d+:\d+$/ })
  async handleCompletionatorSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const choice = interaction.values?.[0];
    if (!choice) {
      await interaction.reply({
        content: "No selection received.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (choice === COMPLETIONATOR_SKIP_SENTINEL) {
      await updateImportItem(itemId, { status: "SKIPPED" });
      await this.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (choice === "import-igdb") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.promptCompletionatorIgdbSelection(interaction, session, item);
      return;
    }

    const gameId = Number(choice);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid game selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Import item not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await this.handleCompletionatorMatch(
      interaction,
      session,
      item,
      gameId,
      this.isInteractionEphemeral(interaction),
    );
  }

  @SelectMenuComponent({ id: /^comp-import-update-fields:\d+:\d+:\d+$/ })
  async handleCompletionatorUpdateFields(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.completionId) {
      await interaction.reply({
        content: "Import item not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const existing = await Member.getCompletion(item.completionId);
    if (!existing) {
      await interaction.reply({
        content: "Completion not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const updates = this.buildCompletionUpdate(existing, item);
    if (!updates) {
      await updateImportItem(item.itemId, { status: "SKIPPED" });
      await this.processNextCompletionatorItem(interaction, session, { ephemeral });
      return;
    }

    const selected = new Set(interaction.values ?? []);
    const filtered: Partial<{
      completionType: string;
      completedAt: Date | null;
      finalPlaytimeHours: number | null;
    }> = {};

    if (selected.has("type") && updates.completionType !== undefined) {
      filtered.completionType = updates.completionType;
    }
    if (selected.has("date") && updates.completedAt !== undefined) {
      filtered.completedAt = updates.completedAt;
    }
    if (selected.has("playtime") && updates.finalPlaytimeHours !== undefined) {
      filtered.finalPlaytimeHours = updates.finalPlaytimeHours;
    }

    if (!Object.keys(filtered).length) {
      await updateImportItem(item.itemId, { status: "SKIPPED" });
      await this.processNextCompletionatorItem(interaction, session, { ephemeral });
      return;
    }

    await Member.updateCompletion(interaction.user.id, existing.completionId, filtered);
    await updateImportItem(item.itemId, {
      status: "UPDATED",
      gameDbGameId: item.gameDbGameId,
      completionId: existing.completionId,
    });
    await this.processNextCompletionatorItem(interaction, session, { ephemeral });
  }

  @ButtonComponent({
    id: /^comp-import-action:\d+:\d+:\d+:(add|update|skip|pause|manual|igdb|igdb-manual|igdb-query|query|same-yes|same-no)$/,
  })
  async handleCompletionatorAction(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, action] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ephemeral = this.isInteractionEphemeral(interaction);
    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import action.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (action === "add") {
      const item = await getImportItemById(itemId);
      if (!item || !item.gameDbGameId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const state = this.getOrCreateCompletionatorAddFormState(
        session,
        item,
        item.gameDbGameId,
        interaction.user.id,
      );
      if (!state.platformId && !state.otherPlatform) {
        await this.renderCompletionatorAddForm(
          interaction,
          session,
          item,
          item.gameDbGameId,
          this.isInteractionEphemeral(interaction),
          undefined,
          "Select a platform before adding this completion.",
        );
        return;
      }
      if (state.dateChoice === "date" && !state.customDate) {
        await this.showCompletionatorDateModal(interaction, session, item);
        return;
      }
      if (state.dateChoice === "csv" && !item.completedAt) {
        await this.renderCompletionatorAddForm(
          interaction,
          session,
          item,
          item.gameDbGameId,
          this.isInteractionEphemeral(interaction),
          undefined,
          "The CSV date is missing. Choose another date option.",
        );
        return;
      }

      const completedAt = this.resolveCompletionatorDateChoice(state, item);
      if (state.otherPlatform) {
        await notifyUnknownCompletionPlatform(interaction, item.gameTitle, item.gameDbGameId);
      }

      const removeFromNowPlaying = await resolveNowPlayingRemoval(
        interaction,
        interaction.user.id,
        item.gameDbGameId,
        item.gameTitle,
        completedAt,
        true,
      );
      const completionId = await Member.addCompletion({
        userId: interaction.user.id,
        gameId: item.gameDbGameId,
        completionType: state.completionType ?? "Main Story",
        platformId: state.otherPlatform ? null : state.platformId,
        completedAt,
        finalPlaytimeHours: item.playtimeHours,
        note: null,
      });
      if (removeFromNowPlaying) {
        await Member.removeNowPlaying(interaction.user.id, item.gameDbGameId).catch(() => {});
      }

      completionatorAddFormStates.delete(
        this.getCompletionatorFormKey(session.importId, item.itemId),
      );
      await updateImportItem(item.itemId, {
        status: "IMPORTED",
        gameDbGameId: item.gameDbGameId,
        completionId,
      });
      await this.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (action === "same-yes") {
      const item = await getImportItemById(itemId);
      if (!item || !item.completionId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const existing = await Member.getCompletion(item.completionId);
      if (!existing) {
        await interaction.reply({
          content: "Completion not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const updates = this.buildCompletionUpdate(existing, item);
      if (!updates) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session, { ephemeral });
        return;
      }

      await this.renderCompletionatorUpdateSelection(
        interaction,
        session,
        item,
        existing,
        ephemeral,
      );
      return;
    }

    if (action === "same-no") {
      const item = await getImportItemById(itemId);
      if (!item || !item.gameDbGameId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.renderCompletionatorAddForm(
        interaction,
        session,
        item,
        item.gameDbGameId,
        this.isInteractionEphemeral(interaction),
      );
      return;
    }

    if (action === "igdb") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const searchTitle = this.stripCompletionatorYear(item.gameTitle);
      await this.promptCompletionatorIgdbSelection(
        interaction,
        session,
        item,
        searchTitle,
      );
      return;
    }

    if (action === "igdb-query") {
      await this.showCompletionatorInputModal(
        interaction,
        "igdb-query",
        "IGDB Search",
        "IGDB search string",
        "Search IGDB",
        session,
        itemId,
      );
      return;
    }

    if (action === "igdb-manual") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.showCompletionatorInputModal(
        interaction,
        "igdb-manual",
        "IGDB ID",
        `IGDB id for "${item.gameTitle}"`,
        "",
        session,
        item.itemId,
        item.gameTitle,
      );
      return;
    }

    if (action === "query") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.showCompletionatorInputModal(
        interaction,
        "gamedb-query",
        "GameDB Search",
        `GameDB search string for "${item.gameTitle}"`,
        item.gameTitle,
        session,
        item.itemId,
        item.gameTitle,
      );
      return;
    }

    if (action === "manual") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.showCompletionatorInputModal(
        interaction,
        "gamedb-manual",
        "GameDB ID",
        `GameDB id for "${item.gameTitle}"`,
        "",
        session,
        item.itemId,
        item.gameTitle,
      );
      return;
    }

    if (action === "pause") {
      await this.pauseCompletionatorImport(interaction, session);
      return;
    }

    if (action === "skip") {
      completionatorAddFormStates.delete(this.getCompletionatorFormKey(importId, itemId));
      await updateImportItem(itemId, { status: "SKIPPED" });
      await this.processNextCompletionatorItem(interaction, session);
      return;
    }

    if (action === "update") {
      const item = await getImportItemById(itemId);
      if (!item || !item.gameDbGameId || !item.completionId) {
        await interaction.reply({
          content: "Import item data is missing. Please resume the import.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const existing = await Member.getCompletion(item.completionId);
      if (!existing) {
        await interaction.reply({
          content: "Completion not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const updates = this.buildCompletionUpdate(existing, item);
      if (!updates) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      await Member.updateCompletion(interaction.user.id, existing.completionId, updates);
      await updateImportItem(item.itemId, {
        status: "UPDATED",
        gameDbGameId: item.gameDbGameId,
        completionId: existing.completionId,
      });
      await this.processNextCompletionatorItem(interaction, session);
    }
  }

  @SelectMenuComponent({ id: /^comp-import-form-select:\d+:\d+:\d+:(type|date|platform)$/ })
  async handleCompletionatorFormSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw, field] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.gameDbGameId) {
      await interaction.reply({
        content: "Import item data is missing. Please resume the import.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const value = interaction.values?.[0];
    if (!value) {
      await interaction.reply({
        content: "No selection received.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = this.getOrCreateCompletionatorAddFormState(
      session,
      item,
      item.gameDbGameId,
      interaction.user.id,
    );

    if (field === "type") {
      const normalized = COMPLETION_TYPES.find((t) => t === value);
      if (!normalized) {
        await interaction.reply({
          content: "Invalid completion type selected.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      state.completionType = normalized;
    } else if (field === "date") {
      const choice = value as CompletionatorDateChoice;
      if (!["csv", "today", "unknown", "date"].includes(choice)) {
        await interaction.reply({
          content: "Invalid date option selected.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      state.dateChoice = choice;
      if (choice !== "date") {
        state.customDate = null;
      }
      if (choice === "date") {
        await this.showCompletionatorDateModal(interaction, session, item);
        return;
      }
    } else if (field === "platform") {
      if (value === "other") {
        state.otherPlatform = true;
        state.platformId = null;
      } else {
        const platformId = Number(value);
        const platforms = await Game.getPlatformsForGameWithStandard(
          item.gameDbGameId,
          STANDARD_PLATFORM_IDS,
        );
        const platformIds = new Set(platforms.map((platform) => platform.id));
        if (!Number.isInteger(platformId) || !platformIds.has(platformId)) {
          await interaction.reply({
            content: "Invalid platform selected.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        state.platformId = platformId;
        state.otherPlatform = false;
      }
    }

    await interaction.deferUpdate().catch(() => {});
    const context = completionatorThreadContexts.get(
      this.getCompletionatorThreadKey(ownerId, session.importId),
    );
    await this.renderCompletionatorAddForm(
      interaction,
      session,
      item,
      item.gameDbGameId,
      this.isInteractionEphemeral(interaction),
      context,
    );
  }

  @ModalComponent({ id: /^comp-import-date:\d+:\d+:\d+$/ })
  async handleCompletionatorDateModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const importId = Number(importIdRaw);
    const itemId = Number(itemIdRaw);
    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item || !item.gameDbGameId) {
      await interaction.reply({
        content: "Import item data is missing. Please resume the import.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawValue = interaction.fields.getTextInputValue("completion-date")?.trim();
    let parsedDate: Date | null = null;
    try {
      parsedDate = parseCompletionDateInput(rawValue);
    } catch (err: any) {
      await interaction.reply({
        content: err?.message ?? "Invalid completion date.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!parsedDate) {
      await interaction.reply({
        content: "Completion date is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const state = this.getOrCreateCompletionatorAddFormState(
      session,
      item,
      item.gameDbGameId,
      interaction.user.id,
    );
    state.customDate = parsedDate;
    state.dateChoice = "date";

    const key = this.getCompletionatorThreadKey(ownerId, session.importId);
    const context = completionatorThreadContexts.get(key);
    const payload = await this.buildCompletionatorAddFormPayload(
      session,
      item,
      item.gameDbGameId,
      ownerId,
    );
    if (context?.message) {
      await context.message.edit({
        components: payload.components,
        files: payload.files,
        flags: buildComponentsV2Flags(false),
      }).catch(() => {});
    }

    await interaction.reply({
      content: "Completion date saved.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({ id: /^comp-import-modal:(gamedb-query|igdb-query|gamedb-manual|igdb-manual):\d+:\d+:\d+$/ })
  async handleCompletionatorInputModal(
    interaction: ModalSubmitInteraction,
  ): Promise<void> {
    const parts = interaction.customId.split(":");
    const kind = parts[1] as CompletionatorModalKind;
    const ownerId = parts[2];
    const importId = Number(parts[3]);
    const itemId = Number(parts[4]);

    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This import prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
      await interaction.reply({
        content: "Invalid import request.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getImportById(importId);
    if (!session) {
      await interaction.reply({
        content: "Import session not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getImportItemById(itemId);
    if (!item) {
      await interaction.reply({
        content: "Import item not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const rawValue = interaction.fields.getTextInputValue("completionator-input")?.trim();
    if (!rawValue) {
      await interaction.reply({
        content: "Input is required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const context = completionatorThreadContexts.get(
      this.getCompletionatorThreadKey(ownerId, session.importId),
    );

    if (kind === "gamedb-query") {
      const normalized = this.stripCompletionatorYear(rawValue);
      const results = await this.searchGameDbWithFallback(normalized);
      if (!results.length) {
        const actionLines = [
          ...this.buildCompletionatorBaseLines(session, item),
          "",
          `No GameDB matches found for "${rawValue}".`,
          "Use the buttons below to search again, skip, or pause.",
        ];
        const queryButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${ownerId}:${session.importId}:${item.itemId}:query`,
          )
          .setLabel("Search Again")
          .setStyle(ButtonStyle.Secondary);
        const skipButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${ownerId}:${session.importId}:${item.itemId}:skip`,
          )
          .setLabel("Skip")
          .setStyle(ButtonStyle.Secondary);
        const pauseButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${ownerId}:${session.importId}:${item.itemId}:pause`,
          )
          .setLabel("Pause")
          .setStyle(ButtonStyle.Secondary);
        await this.respondToImportInteraction(
          interaction,
          {
            components: this.buildCompletionatorComponents(actionLines, [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                queryButton,
                skipButton,
                pauseButton,
              ),
            ]),
          },
          false,
          context,
        );
        return;
      }

      const baseLines = this.buildCompletionatorBaseLines(session, item);
      await this.renderCompletionatorGameDbResults(
        interaction,
        session,
        item,
        results,
        baseLines,
        false,
        context,
      );
      return;
    }

    if (kind === "igdb-query") {
      await this.promptCompletionatorIgdbSelection(
        interaction,
        session,
        item,
        rawValue,
        context,
      );
      return;
    }

    if (kind === "igdb-manual") {
      const igdbId = Number(rawValue);
      if (!Number.isInteger(igdbId) || igdbId <= 0) {
        await updateImportItem(item.itemId, {
          status: "ERROR",
          errorText: "Invalid IGDB id entered.",
        });
        await this.processNextCompletionatorItem(interaction, session, { context });
        return;
      }

      const imported = await this.importGameFromIgdb(igdbId);
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        imported.gameId,
        false,
        context,
      );
      return;
    }

    if (kind === "gamedb-manual") {
      const manualId = Number(rawValue);
      if (!Number.isInteger(manualId) || manualId <= 0) {
        await updateImportItem(item.itemId, {
          status: "ERROR",
          errorText: "Invalid GameDB id entered.",
        });
        await this.processNextCompletionatorItem(interaction, session, { context });
        await interaction.editReply({
          content: "Updated.",
        }).catch(() => {});
        return;
      }

      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        manualId,
        false,
        context,
      );
    }
  }

  @Slash({
    description: "Import completions from a Completionator CSV",
    name: "completionator-import",
  })
  async completionatorImport(
    @SlashChoice(
      ...COMPLETIONATOR_STATUS_OPTIONS.map((value) => ({
        name: value,
        value,
      })),
    )
    @SlashOption({
      description: "Action to perform",
      name: "action",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    action: CompletionatorAction,
    @SlashOption({
      description: "Completionator CSV file (required for start)",
      name: "file",
      required: false,
      type: ApplicationCommandOptionType.Attachment,
    })
    file: Attachment | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = interaction.channel?.id !== BOT_DEV_CHANNEL_ID;
    await safeDeferReply(interaction, {
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    const userId = interaction.user.id;
    const guild = interaction.guild;

    if (!guild) {
      await safeReply(interaction, {
        content: "This command can only be used inside a server.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (action === "start") {
      if (!file?.url) {
        await safeReply(interaction, {
          content: "Please attach the Completionator CSV file.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const csvText = await this.fetchCsv(file.url);
      if (!csvText) {
        await safeReply(interaction, {
          content: "Failed to download the CSV file.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const parsed = this.parseCompletionatorCsv(csvText);
      if (!parsed.length) {
        await safeReply(interaction, {
          content: "No rows found in the CSV file.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const session = await createImportSession({
        userId,
        totalCount: parsed.length,
        sourceFilename: file.name ?? null,
      });
      await insertImportItems(session.importId, parsed);

      const context: CompletionatorThreadContext | null =
        await this.getOrCreateCompletionatorThread(interaction, session);
      if (!context) return;
      const threadMention: string = `<#${context.threadId}>`;

      await safeReply(interaction, {
        content:
          `Import session #${session.importId} created with ${parsed.length} rows. ` +
          `Starting review in ${threadMention}.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });

      await this.processNextCompletionatorItem(interaction, session, {
        ephemeral,
        context,
      });
      return;
    }

    if (action === "status") {
      const session = await getActiveImportForUser(userId);
      if (!session) {
        await safeReply(interaction, {
          content: "No active import session found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      const stats = await countImportItems(session.importId);
      const embed = new EmbedBuilder()
        .setTitle(`Completionator Import #${session.importId}`)
        .setDescription(`Status: ${session.status}`)
        .addFields(
          { name: "Pending", value: String(stats.pending), inline: true },
          { name: "Imported", value: String(stats.imported), inline: true },
          { name: "Updated", value: String(stats.updated), inline: true },
          { name: "Skipped", value: String(stats.skipped), inline: true },
          { name: "Errors", value: String(stats.error), inline: true },
        );

      await safeReply(interaction, {
        embeds: [embed],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await getActiveImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active import session found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (action === "pause") {
      await this.pauseCompletionatorImport(interaction, session);
      return;
    }

    if (action === "cancel") {
      await setImportStatus(session.importId, "CANCELED");
      await safeReply(interaction, {
        content: `Import #${session.importId} canceled.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await setImportStatus(session.importId, "ACTIVE");
    const context: CompletionatorThreadContext | null =
      await this.getOrCreateCompletionatorThread(interaction, session);
    if (!context) return;
    await safeReply(interaction, {
      content:
        `Import #${session.importId} is paused. ` +
        "Resume with `/game-completion completionator-import action:resume`.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });

    await this.processNextCompletionatorItem(interaction, session, {
      ephemeral,
      context,
    });
  }

  @SelectMenuComponent({ id: /^completion-add-select:.+/ })
  async handleCompletionAddSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const ctx = completionAddSessions.get(sessionId);

    if (!ctx) {
      await interaction
        .reply({
          content: "This completion prompt has expired.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    if (interaction.user.id !== ctx.userId) {
      await interaction
        .reply({
          content: "This completion prompt isn't for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const value = interaction.values?.[0];
    if (!value) {
      await interaction
        .reply({
          content: "No selection received.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    try {
      await this.processCompletionSelection(interaction, value, ctx);
    } finally {
      completionAddSessions.delete(sessionId);
      try {
        await interaction.editReply({ components: [] }).catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  @SelectMenuComponent({ id: /^comp-del-menu:.+$/ })
  async handleCompletionDeleteMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This delete prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const completionId = Number(interaction.values[0]);
    if (!Number.isInteger(completionId) || completionId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await Member.deleteCompletion(ownerId, completionId);
    if (!ok) {
      await interaction.reply({
        content: "Completion not found or could not be deleted.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Deleted completion #${completionId}.`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      await interaction.message.edit({ components: [] }).catch(() => {});
    } catch {
      // ignore
    }
  }

  @SelectMenuComponent({ id: /^comp-edit-menu:.+$/ })
  async handleCompletionEditMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const completionId = Number(interaction.values[0]);
    if (!Number.isInteger(completionId) || completionId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const completion = await Member.getCompletion(completionId);
    if (!completion) {
      await interaction.reply({
        content: "Completion not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const response = this.buildCompletionEditPrompt(ownerId, completionId, completion);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response).catch(() => {});
    } else {
      await interaction.update(response).catch(() => {});
    }
  }

  private buildCompletionEditPrompt(
    ownerId: string,
    completionId: number,
    completion: Awaited<ReturnType<typeof Member.getCompletion>>,
    notice?: string | null,
  ): {
    content: string;
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    if (!completion) {
      return {
        content: "Completion not found.",
        embeds: [],
        components: [],
      };
    }

    const fieldButtons = [
      new ButtonBuilder()
        .setCustomId(`comp-edit-field:${ownerId}:${completionId}:type`)
        .setLabel("Completion Type")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-edit-field:${ownerId}:${completionId}:date`)
        .setLabel("Completion Date")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-edit-field:${ownerId}:${completionId}:playtime`)
        .setLabel("Final Playtime")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-edit-field:${ownerId}:${completionId}:note`)
        .setLabel("Note")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-edit-done:${ownerId}:${completionId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Success),
    ];

    const currentParts = [
      completion.completionType,
      completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date",
      completion.finalPlaytimeHours != null
        ? formatPlaytimeHours(completion.finalPlaytimeHours)
        : null,
    ].filter(Boolean);
    const noteLine = completion.note ? `\n> ${completion.note}` : "";

    const noticeLine = notice ? `${notice}\n` : "";
    return {
      content: `${noticeLine}Editing **${completion.title}** — choose a field to update:`,
      embeds: [
        new EmbedBuilder().setDescription(`Current: ${currentParts.join(" — ")}${noteLine}`),
      ],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(fieldButtons)],
    };
  }

  @ButtonComponent({ id: /^comp-edit-done:[^:]+:\d+$/ })
  async handleCompletionEditDone(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.update({
      content: "Edit complete.",
      embeds: [],
      components: [],
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^comp-edit-field:[^:]+:\d+:(type|date|playtime|note)$/ })
  async handleCompletionFieldEdit(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, completionIdRaw, field] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const completionId = Number(completionIdRaw);
    if (!Number.isInteger(completionId) || completionId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (field === "type") {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`comp-edit-type-select:${ownerId}:${completionId}`)
        .setPlaceholder("Select completion type")
        .addOptions(COMPLETION_TYPES.map((t) => ({ label: t, value: t })));

      await interaction
        .update({
          content: "Select the new completion type:",
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
          embeds: interaction.message?.embeds?.length ? interaction.message.embeds : undefined,
        })
        .catch(() => {});
      return;
    }

    const prompt =
      field === "date"
        ? "Type the new completion date (e.g., 2025-12-11)."
        : field === "playtime"
          ? "Type the new final playtime in hours (e.g., 42.5)."
          : "Type the new note (or `clear` to remove it).";

    await interaction
      .update({
        content: prompt,
        components: [],
        embeds: interaction.message?.embeds?.length ? interaction.message.embeds : undefined,
      })
      .catch(() => {});

    const channel = interaction.channel;
    if (!channel || !("awaitMessages" in channel)) {
      const updated = await Member.getCompletion(completionId);
      if (updated) {
        await interaction.message
          .edit(
            this.buildCompletionEditPrompt(
              ownerId,
              completionId,
              updated,
              "I couldn't listen for your response in this channel.",
            ),
          )
          .catch(() => {});
      }
      return;
    }

    const collected = await (channel as any)
      .awaitMessages({
        filter: (m: Message) => m.author.id === interaction.user.id,
        max: 1,
        time: 60_000,
      })
      .catch(() => null);

    const message = collected?.first();
    if (!message) {
      const updated = await Member.getCompletion(completionId);
      if (updated) {
        await interaction.message
          .edit(
            this.buildCompletionEditPrompt(
              ownerId,
              completionId,
              updated,
              "Timed out waiting for your response.",
            ),
          )
          .catch(() => {});
      }
      return;
    }

    const value = message.content.trim();
    try {
      if (field === "date") {
        const dt = parseCompletionDateInput(value);
        await Member.updateCompletion(ownerId, completionId, { completedAt: dt });
      } else if (field === "playtime") {
        const num = Number(value);
        if (Number.isNaN(num) || num < 0)
          throw new Error("Playtime must be a non-negative number.");
        await Member.updateCompletion(ownerId, completionId, { finalPlaytimeHours: num });
      } else if (field === "note") {
        if (/^clear$/i.test(value)) {
          await Member.updateCompletion(ownerId, completionId, { note: null });
        } else if (value.length > this.maxNoteLength) {
          throw new Error(`Note must be ${this.maxNoteLength} characters or fewer.`);
        } else {
          await Member.updateCompletion(ownerId, completionId, { note: value });
        }
      }
      const updated = await Member.getCompletion(completionId);
      if (updated) {
        await interaction.message
          .edit(this.buildCompletionEditPrompt(ownerId, completionId, updated))
          .catch(() => {});
      }
    } catch (err: any) {
      const updated = await Member.getCompletion(completionId);
      if (updated) {
        await interaction.message
          .edit(
            this.buildCompletionEditPrompt(
              ownerId,
              completionId,
              updated,
              err?.message ?? "Failed to update completion.",
            ),
          )
          .catch(() => {});
      }
    } finally {
      try {
        await message.delete().catch(() => {});
      } catch {
        // ignore
      }
    }
  }

  @SelectMenuComponent({ id: /^comp-edit-type-select:[^:]+:\d+$/ })
  async handleCompletionTypeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId, completionIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This edit prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const completionId = Number(completionIdRaw);
    const value = interaction.values[0];
    const normalized = COMPLETION_TYPES.find((t) => t.toLowerCase() === value.toLowerCase());

    if (!normalized) {
      const updated = await Member.getCompletion(completionId);
      if (updated) {
        await interaction
          .update(
            this.buildCompletionEditPrompt(
              ownerId,
              completionId,
              updated,
              "Invalid completion type selected.",
            ),
          )
          .catch(() => {});
      }
      return;
    }

    await Member.updateCompletion(ownerId, completionId, { completionType: normalized });

    const updated = await Member.getCompletion(completionId);
    if (!updated) {
      await interaction
        .update({
          content: "Completion not found.",
          embeds: [],
          components: [],
        })
        .catch(() => {});
      return;
    }

    await interaction
      .update(this.buildCompletionEditPrompt(ownerId, completionId, updated))
      .catch(() => {});
  }

  @SelectMenuComponent({ id: /^comp-page-select:.+$/ })
  async handleCompletionPageSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const ownerId = parts[1];
    const yearRaw = parts[2];
    const mode = parts[3] as "list" | "edit" | "delete";
    const query = parts.slice(4).join(":") || undefined;

    if (mode !== "list" && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(interaction.values[0]);
    if (Number.isNaN(page)) return;
    const year = this.parseCompletionYearFilter(yearRaw);
    const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    if (mode === "list") {
      await this.renderCompletionPage(
        interaction,
        ownerId,
        page,
        year,
        ephemeral,
        query,
      );
    } else {
      await this.renderSelectionPage(interaction, ownerId, page, mode, year, query);
    }
  }

  @ButtonComponent({ id: /^comp-(list|edit|delete)-page:[^:]+:[^:]*:\d+:(prev|next)(?::.*)?$/ })
  async handleCompletionPaging(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const mode = parts[0].split("-")[1] as "list" | "edit" | "delete";
    const ownerId = parts[1];
    const yearRaw = parts[2];
    const pageRaw = parts[3];
    const dir = parts[4];
    const query = parts.slice(5).join(":") || undefined;

    if (mode !== "list" && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;
    const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
    const year = this.parseCompletionYearFilter(yearRaw);
    const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    if (mode === "list") {
      await this.renderCompletionPage(
        interaction,
        ownerId,
        nextPage,
        year,
        ephemeral,
        query,
      );
    } else {
      await this.renderSelectionPage(interaction, ownerId, nextPage, mode, year, query);
    }
  }

  private async renderCompletionLeaderboard(
    interaction: CommandInteraction,
    ephemeral: boolean,
    query?: string,
  ): Promise<void> {
    const leaderboard = await Member.getCompletionLeaderboard(25, query);
    if (!leaderboard.length) {
      await safeReply(interaction, {
        content: query
          ? `No completions found matching "${query}".`
          : "No completions recorded yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const lines = leaderboard.map((m, idx) => {
      const name = m.globalName ?? m.username ?? m.userId;
      const suffix = m.count === 1 ? "completion" : "completions";
      return `${idx + 1}. **${name}**: ${m.count} ${suffix}`;
    });

    const embed = new EmbedBuilder()
      .setTitle("Game Completion Leaderboard")
      .setDescription(lines.join("\n"));
    const trimmedQuery = query?.trim();
    if (trimmedQuery) {
      embed.setFooter({ text: `Filter: "${trimmedQuery}"` });
    }

    const options = leaderboard.map((m) => ({
      label: (m.globalName ?? m.username ?? m.userId).slice(0, 100),
      value: m.userId,
      description: `${m.count} ${m.count === 1 ? "completion" : "completions"}`,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId(`comp-leaderboard-select${trimmedQuery ? `:${trimmedQuery.slice(0, 50)}` : ""}`)
      .setPlaceholder("View completions for a member")
      .addOptions(options);

    await safeReply(interaction, {
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @SelectMenuComponent({ id: /^comp-leaderboard-select(?::.*)?$/ })
  async handleCompletionLeaderboardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const query = parts.slice(1).join(":") || undefined;
    const userId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.renderCompletionPage(interaction, userId, 0, null, true, query);
  }

  private createCompletionSession(ctx: CompletionAddContext): string {
    const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    completionAddSessions.set(sessionId, ctx);
    return sessionId;
  }

  @SelectMenuComponent({ id: /^completion-platform-select:.+/ })
  async handleCompletionPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const ctx = completionPlatformSessions.get(sessionId);

    if (!ctx) {
      await interaction.reply({
        content: "This completion prompt has expired.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (interaction.user.id !== ctx.userId) {
      await interaction.reply({
        content: "This completion prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    const selected = interaction.values?.[0];
    const isOther = selected === "other";
    let platformId: number | null = null;
    if (!isOther) {
      const parsedId = Number(selected);
      if (Number.isInteger(parsedId)) {
        platformId = parsedId;
      }
    }
    const valid = isOther || (
      platformId !== null &&
      ctx.platforms.some((platform) => platform.id === platformId)
    );
    if (!valid) {
      await interaction.reply({
        content: "Invalid platform selection.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    await interaction.deferUpdate().catch(() => {});
    completionPlatformSessions.delete(sessionId);

    if (isOther) {
      await notifyUnknownCompletionPlatform(interaction, ctx.gameTitle, ctx.gameId);
    }

    await saveCompletion(
      interaction,
      ctx.userId,
      ctx.gameId,
      platformId,
      ctx.completionType,
      ctx.completedAt,
      ctx.finalPlaytimeHours,
      ctx.note,
      ctx.gameTitle,
      ctx.announce,
      false,
      ctx.removeFromNowPlaying,
    );

    await interaction.editReply({ components: [] }).catch(() => {});
  }

  private createCompletionPlatformSession(ctx: CompletionPlatformContext): string {
    const sessionId = `comp-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    completionPlatformSessions.set(sessionId, ctx);
    return sessionId;
  }

  private async promptCompletionPlatformSelection(
    interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
    ctx: Omit<CompletionPlatformContext, "platforms">,
  ): Promise<void> {
    const platforms = await Game.getPlatformsForGameWithStandard(
      ctx.gameId,
      STANDARD_PLATFORM_IDS,
    );
    if (!platforms.length) {
      await safeReply(interaction, {
        content: "No platform release data is available for this game.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const platformOptions = [...platforms]
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
      .map((platform) => ({
        id: platform.id,
        name: platform.name,
      }));
    const sessionId = this.createCompletionPlatformSession({
      ...ctx,
      platforms: platformOptions,
    });

    const baseOptions = platformOptions.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const options = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${COMPLETION_PLATFORM_SELECT_PREFIX}:${sessionId}`)
      .setPlaceholder("Select the platform")
      .addOptions(options);
    const content = platformOptions.length > 24
      ? `Select the platform for **${ctx.gameTitle}** (showing first 24).`
      : `Select the platform for **${ctx.gameTitle}**.`;

    await safeReply(interaction, {
      content,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async resolveDefaultCompletionPlatformId(gameId: number): Promise<number | null> {
    const platforms = await Game.getPlatformsForGameWithStandard(
      gameId,
      STANDARD_PLATFORM_IDS,
    );
    return platforms[0]?.id ?? null;
  }

  private async confirmDuplicateCompletion(
    interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
    gameTitle: string,
    existing: Awaited<ReturnType<typeof Member.getRecentCompletionForGame>>,
  ): Promise<boolean> {
    if (!existing) return true;

    const promptId = `comp-dup:${interaction.user.id}:${Date.now()}`;
    const yesId = `${promptId}:yes`;
    const noId = `${promptId}:no`;
    const dateText = existing.completedAt
      ? formatDiscordTimestamp(existing.completedAt)
      : "No date";
    const playtimeText = formatPlaytimeHours(existing.finalPlaytimeHours);
    const detailParts = [existing.completionType, dateText, playtimeText].filter(Boolean);
    const noteLine = existing.note ? `\n> ${existing.note}` : "";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(yesId)
        .setLabel("Add Another")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(noId)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const payload: InteractionReplyOptions = {
      content:
        `We found a completion for **${gameTitle}** within the last week:\n` +
        `• ${detailParts.join(" — ")} (Completion #${existing.completionId})${noteLine}\n\n` +
        "Add another completion anyway?",
      components: [row],
      flags: MessageFlags.Ephemeral,
    };

    let message: Message | null = null;
    try {
      if (interaction.deferred || interaction.replied) {
        const reply = await interaction.followUp(payload);
        message = reply as Message;
      } else {
        const reply = await interaction.reply({ ...payload, withResponse: true });
        message = reply.resource?.message ?? null;
      }
    } catch {
      try {
        const reply = await interaction.followUp(payload);
        message = reply as Message;
      } catch {
        return false;
      }
    }

    if (!message || typeof message.awaitMessageComponent !== "function") {
      return false;
    }

    try {
      const selection = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId.startsWith(promptId),
        time: 120_000,
      });
      const confirmed = selection.customId.endsWith(":yes");
      await selection.update({
        content: confirmed ? "Adding another completion." : "Cancelled.",
        components: [],
      });
      return confirmed;
    } catch {
      return false;
    }
  }

  private parseCompletionYearFilter(value: string | undefined): number | "unknown" | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === "unknown") return "unknown";
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private async fetchCsv(url: string): Promise<string | null> {
    try {
      const response = await axios.get(url, { responseType: "arraybuffer" });
      return Buffer.from(response.data).toString("utf-8");
    } catch {
      return null;
    }
  }

  private parseCompletionatorCsv(csvText: string): Array<{
    rowIndex: number;
    gameTitle: string;
    platformName: string | null;
    regionName: string | null;
    sourceType: string | null;
    timeText: string | null;
    completedAt: Date | null;
    completionType: string | null;
    playtimeHours: number | null;
  }> {
    const rows = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!rows.length) return [];
    const dataRows = rows.slice(1);
    const items: Array<{
      rowIndex: number;
      gameTitle: string;
      platformName: string | null;
      regionName: string | null;
      sourceType: string | null;
      timeText: string | null;
      completedAt: Date | null;
      completionType: string | null;
      playtimeHours: number | null;
    }> = [];

    dataRows.forEach((line, idx) => {
      const fields = this.parseCsvLine(line);
      if (fields.length < 6) return;
      const [name, platform, region, type, timeText, dateText] = fields;
      const completionType = this.mapCompletionatorType(type);
      const completedAt = this.parseCompletionatorDate(dateText);
      const playtimeHours = this.parseCompletionatorTime(timeText);

      items.push({
        rowIndex: idx + 1,
        gameTitle: name.trim(),
        platformName: platform?.trim() || null,
        regionName: region?.trim() || null,
        sourceType: type?.trim() || null,
        timeText: timeText?.trim() || null,
        completedAt,
        completionType,
        playtimeHours,
      });
    });

    return items;
  }

  private parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];

      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }

      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }

      if (char === "," && !inQuotes) {
        fields.push(current);
        current = "";
        continue;
      }

      current += char;
    }
    fields.push(current);
    return fields;
  }

  private mapCompletionatorType(value: string | undefined): string | null {
    const normalized = (value ?? "").trim();
    if (!normalized) return null;
    const lower = normalized.toLowerCase();
    if (lower === "core game") return "Main Story";
    if (lower === "core game (+ a few extras)") return "Main Story + Side Content";
    if (lower === "core game (+ lots of extras)") return "Main Story + Side Content";
    if (lower === "completionated") return "Completionist";
    return null;
  }

  private parseCompletionatorTime(value: string | undefined): number | null {
    if (!value) return null;
    const match = value.trim().match(/(\d+)h:(\d+)m:(\d+)s/i);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return Math.round((hours + minutes / 60) * 100) / 100;
  }

  private parseCompletionatorDate(value: string | undefined): Date | null {
    if (!value) return null;
    const parts = value.trim().split("/");
    if (parts.length !== 3) return null;
    const month = Number(parts[0]);
    const day = Number(parts[1]);
    const year = Number(parts[2]);
    if (!month || !day || !year) return null;
    return new Date(year, month - 1, day);
  }

  private async processNextCompletionatorItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    options?: { ephemeral?: boolean; context?: CompletionatorThreadContext },
  ): Promise<void> {
    const nextItem = await getNextPendingItem(session.importId);
    if (!nextItem) {
      await setImportStatus(session.importId, "COMPLETED");
      await this.respondToImportInteraction(interaction, {
        components: this.buildCompletionatorComponents([
          `## Completionator Import #${session.importId}`,
          "Import completed.",
        ]),
      }, options?.ephemeral, options?.context);
      if (options?.context) {
        const key: string = this.getCompletionatorThreadKey(
          options.context.userId,
          options.context.importId,
        );
        completionatorThreadContexts.delete(key);
      }
      return;
    }

    await updateImportIndex(session.importId, nextItem.rowIndex);
    await this.renderCompletionatorItem(
      interaction,
      session,
      nextItem,
      options?.ephemeral,
      options?.context,
    );
  }

  private buildCompletionatorBaseLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): string[] {
    const platformLabel = formatPlatformDisplayName(item.platformName) ?? "Unknown";
    const completedLabel = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return [
      `## Completionator Import #${session.importId}`,
      `Row ${item.rowIndex} of ${session.totalCount}`,
      "",
      `**Title:** ${item.gameTitle}`,
      `**Platform:** ${platformLabel}`,
      `**Region:** ${item.regionName ?? "Unknown"}`,
      `**Type:** ${item.sourceType ?? "Unknown"}`,
      `**Playtime:** ${item.timeText ?? "Unknown"}`,
      `**Completed:** ${completedLabel}`,
    ];
  }

  private buildCompletionatorActionLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    actionText: string,
  ): string[] {
    return [
      ...this.buildCompletionatorBaseLines(session, item),
      "",
      `**Action:** ${actionText}`,
    ];
  }

  private buildCompletionatorContainer(
    lines: string[],
    thumbnailName?: string,
  ): ContainerBuilder {
    const content = lines.join("\n").trim();
    const container = new ContainerBuilder();
    if (thumbnailName) {
      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(`attachment://${thumbnailName}`),
        );
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
    return container;
  }

  private buildCompletionatorComponents(
    lines: string[],
    rows: ActionRowBuilder<any>[] = [],
    extraContainers: ContainerBuilder[] = [],
  ): Array<ContainerBuilder | ActionRowBuilder<any>> {
    return [
      this.buildCompletionatorContainer(lines),
      ...extraContainers,
      ...rows,
    ];
  }

  private getCompletionatorAttachments(): AttachmentBuilder[] {
    return [];
  }

  private getCompletionatorFormKey(importId: number, itemId: number): string {
    return `${importId}:${itemId}`;
  }

  private getOrCreateCompletionatorAddFormState(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ownerId: string,
  ): CompletionatorAddFormState {
    const key = this.getCompletionatorFormKey(session.importId, item.itemId);
    const existing = completionatorAddFormStates.get(key);
    if (existing) return existing;

    const mappedType = this.mapCompletionatorType(item.sourceType ?? undefined);
    const defaultType = COMPLETION_TYPES.includes(mappedType as CompletionType)
      ? (mappedType as CompletionType)
      : COMPLETION_TYPES.includes(item.completionType as CompletionType)
        ? (item.completionType as CompletionType)
        : "Main Story";
    const defaultDateChoice: CompletionatorDateChoice =
      item.completedAt ? "csv" : "unknown";
    const state: CompletionatorAddFormState = {
      ownerId,
      importId: session.importId,
      itemId: item.itemId,
      gameId,
      completionType: defaultType,
      dateChoice: defaultDateChoice,
      customDate: null,
      platformId: null,
      otherPlatform: false,
    };
    completionatorAddFormStates.set(key, state);
    return state;
  }

  private async buildCompletionatorExistingCompletionsContainer(
    userId: string,
    gameId: number,
    mappedType: string,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): Promise<{
    container: ContainerBuilder;
    files: AttachmentBuilder[];
    changeRow: ActionRowBuilder<ButtonBuilder>;
  }> {
    const game = await Game.getGameById(gameId);
    const completions = await Member.getCompletionsForGame(userId, gameId);
    const gamePlatforms = await Game.getPlatformsForGame(gameId);
    const platforms = await Game.getAllPlatforms();
    const platformMap = new Map(
      platforms.map((platform) => [platform.id, platform.name]),
    );
    const formattedPlatforms = gamePlatforms
      .map((platform) => formatPlatformDisplayName(platform.name) ?? platform.name)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    const platformLine = formattedPlatforms.length
      ? `**Platforms:** ${formattedPlatforms.join(", ")}`
      : "**Platforms:** None listed";

    const gameIdLine = game ? `**GameDB ID:** ${game.id}` : "**GameDB ID:** Unknown";
    const lines: string[] = [
      "## Matched Game",
      game ? `**Title:** ${game.title}` : "**Title:** Unknown",
      gameIdLine,
      `**Mapped Type:** ${mappedType}`,
      platformLine,
      "",
      "## Your Existing Completions",
    ];
    if (!completions.length) {
      lines.push("No completions recorded for this game yet.");
    } else {
      completions.forEach((completion) => {
        const dateLabel = completion.completedAt
          ? formatTableDate(completion.completedAt)
          : "Unknown";
        const playtimeLabel = formatPlaytimeHours(completion.finalPlaytimeHours);
        const platformName = completion.platformId
          ? platformMap.get(completion.platformId) ?? "Unknown Platform"
          : "Unknown Platform";
        const formattedPlatform = formatPlatformDisplayName(platformName) ?? platformName;
        const parts = [
          completion.completionType ?? "Unknown",
          dateLabel,
          playtimeLabel,
          formattedPlatform,
        ].filter(Boolean);
        lines.push(`• ${parts.join(" - ")}`);
      });
    }
    lines.push(
      "",
      "If this completion is not listed above, complete the form below.",
      "Select a completion type, choose a date option, select a platform, then add the completion.",
    );

    const files: AttachmentBuilder[] = [];
    if (game) {
      const primaryArt = game.thumbnailBad ? game.imageData : (game.artData ?? game.imageData);
      if (primaryArt) {
        files.push(
          new AttachmentBuilder(primaryArt, { name: COMPLETIONATOR_MATCH_THUMBNAIL_NAME }),
        );
      }
    }
    const thumbnailName = files.length ? COMPLETIONATOR_MATCH_THUMBNAIL_NAME : undefined;
    const container = this.buildCompletionatorContainer(lines, thumbnailName);
    const changeButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${userId}:${session.importId}:${item.itemId}:igdb`,
      )
      .setLabel("Choose a Different Game")
      .setStyle(ButtonStyle.Secondary);
    const changeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(changeButton);
    return { container, files, changeRow };
  }

  private buildCompletionatorAddFormRows(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
    platforms: Array<{ id: number; name: string }>,
  ): ActionRowBuilder<any>[] {
    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:type`,
      )
      .setPlaceholder("Completion type")
      .addOptions(
        COMPLETION_TYPES.map((value) => ({
          label: value.slice(0, 100),
          value,
          default: state.completionType === value,
        })),
      );

    const dateOptions: Array<{ label: string; value: CompletionatorDateChoice; default?: boolean }> = [];
    if (item.completedAt) {
      dateOptions.push({
        label: `Use CSV date (${formatTableDate(item.completedAt)})`,
        value: "csv",
        default: state.dateChoice === "csv",
      });
    }
    dateOptions.push(
      {
        label: "Today",
        value: "today",
        default: state.dateChoice === "today",
      },
      {
        label: "Unknown date",
        value: "unknown",
        default: state.dateChoice === "unknown",
      },
      {
        label: "Enter date",
        value: "date",
        default: state.dateChoice === "date",
      },
    );

    const dateSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:date`,
      )
      .setPlaceholder("Completion date")
      .addOptions(dateOptions);

    const sortedPlatforms = [...platforms].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    const platformOptions = sortedPlatforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
      default: state.platformId === platform.id,
    }));
    const options = [
      ...platformOptions.slice(0, 24),
      { label: "Other", value: "other", default: state.otherPlatform },
    ];
    const platformSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-form-select:${state.ownerId}:${state.importId}:${state.itemId}:platform`,
      )
      .setPlaceholder("Platform")
      .addOptions(options);

    const addButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:add`,
      )
      .setLabel("Add Completion")
      .setStyle(ButtonStyle.Success);
    const skipButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:skip`,
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary);
    const pauseButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${state.ownerId}:${state.importId}:${state.itemId}:pause`,
      )
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary);

    return [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(typeSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(dateSelect),
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(platformSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(addButton, skipButton, pauseButton),
    ];
  }

  private async renderCompletionatorItem(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const searchTitle = this.stripCompletionatorYear(item.gameTitle);
    const results = await this.searchGameDbWithFallback(searchTitle);
    const baseLines = this.buildCompletionatorBaseLines(session, item);

    if (!results.length) {
      const actionLines = this.buildCompletionatorActionLines(
        session,
        item,
        "Awaiting GameDB id",
      );
      const rows = this.buildCompletionatorNoMatchRows(
        interaction.user.id,
        session.importId,
        item.itemId,
      );
      await this.respondToImportInteraction(interaction, {
        components: this.buildCompletionatorComponents(
          [
            ...actionLines,
            "",
            `No GameDB matches found for "${item.gameTitle}". Choose an option below.`,
          ],
          rows,
        ),
      }, ephemeral, context);
      return;
    }

    if (results.length === 1) {
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        results[0].id,
        ephemeral,
        context,
      );
      return;
    }

    await this.renderCompletionatorGameDbResults(
      interaction,
      session,
      item,
      results,
      baseLines,
      ephemeral,
      context,
    );
  }

  private async handleCompletionatorMatch(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const game = await Game.getGameById(gameId);
    if (!game) {
      await updateImportItem(item.itemId, {
        gameDbGameId: null,
        errorText: `GameDB id ${gameId} not found.`,
      });
      const actionLines = this.buildCompletionatorActionLines(
        session,
        item,
        "Awaiting GameDB id",
      );
      const rows = this.buildCompletionatorNoMatchRows(
        interaction.user.id,
        session.importId,
        item.itemId,
      );
      await this.respondToImportInteraction(interaction, {
        components: this.buildCompletionatorComponents(
          [
            ...actionLines,
            "",
            `GameDB id ${gameId} was not found. Choose another option below.`,
          ],
          rows,
        ),
      }, ephemeral, context);
      return;
    }

    const existing = await Member.getCompletionByGameId(interaction.user.id, gameId);
    if (!existing) {
      await updateImportItem(item.itemId, {
        gameDbGameId: gameId,
      });

      await this.renderCompletionatorAddForm(
        interaction,
        session,
        item,
        gameId,
        Boolean(ephemeral),
        context,
      );
      return;
    }

    const updates = this.buildCompletionUpdate(existing, item);
    await updateImportItem(item.itemId, {
      gameDbGameId: gameId,
      completionId: existing.completionId,
    });

    if (!updates) {
      await updateImportItem(item.itemId, {
        status: "SKIPPED",
        gameDbGameId: gameId,
        completionId: existing.completionId,
      });
      await this.processNextCompletionatorItem(interaction, session, { context });
      return;
    }

    const shouldConfirmSame = this.shouldConfirmCompletionMatch(existing, item);
    if (shouldConfirmSame) {
      const confirmLines = this.buildCompletionSameCheckLines(session, item, existing);
      const mappedType = this.mapCompletionatorType(item.sourceType ?? undefined)
        ?? item.completionType
        ?? "Unknown";
      const existingPayload = await this.buildCompletionatorExistingCompletionsContainer(
        interaction.user.id,
        gameId,
        mappedType,
        session,
        item,
      );
      const confirmButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:same-yes`,
          )
          .setLabel("Yes")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:same-no`,
          )
          .setLabel("No")
          .setStyle(ButtonStyle.Secondary),
      );

      await this.respondToImportInteraction(interaction, {
        components: this.buildCompletionatorComponents(
          confirmLines,
          [confirmButtons, existingPayload.changeRow],
          [existingPayload.container],
        ),
        files: existingPayload.files,
      }, ephemeral, context);
      return;
    }

    await this.renderCompletionatorUpdateSelection(
      interaction,
      session,
      item,
      existing,
      ephemeral,
      context,
    );
  }

  private async renderCompletionatorUpdateSelection(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const updateLines = this.buildCompletionatorUpdateLines(session, item, existing);
    const gameId = item.gameDbGameId ?? existing?.gameId ?? 0;
    const mappedType = this.mapCompletionatorType(item.sourceType ?? undefined)
      ?? item.completionType
      ?? "Unknown";
    const existingPayload = gameId
      ? await this.buildCompletionatorExistingCompletionsContainer(
          interaction.user.id,
          gameId,
          mappedType,
          session,
          item,
        )
      : null;
    const updateOptions = this.buildCompletionUpdateOptions(existing, item);
    if (!updateOptions.length) {
      await updateImportItem(item.itemId, {
        status: "SKIPPED",
        gameDbGameId: item.gameDbGameId ?? null,
        completionId: existing?.completionId ?? null,
      });
      await this.processNextCompletionatorItem(interaction, session, {
        ephemeral,
        context,
      });
      return;
    }

    const updateSelect = new StringSelectMenuBuilder()
      .setCustomId(
        `comp-import-update-fields:${interaction.user.id}:${session.importId}:${item.itemId}`,
      )
      .setPlaceholder("Select fields to update")
      .setMinValues(1)
      .setMaxValues(updateOptions.length)
      .addOptions(updateOptions);

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:skip`,
        )
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(
          `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:pause`,
        )
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );

    const extraContainers = existingPayload ? [existingPayload.container] : [];
    await this.respondToImportInteraction(interaction, {
      components: this.buildCompletionatorComponents(updateLines, [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(updateSelect),
        buttons,
        ...(existingPayload ? [existingPayload.changeRow] : []),
      ], extraContainers),
      files: existingPayload?.files,
    }, ephemeral, context);
  }

  private async renderCompletionatorAddForm(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ephemeral: boolean,
    context?: CompletionatorThreadContext,
    notice?: string,
  ): Promise<void> {
    const payload = await this.buildCompletionatorAddFormPayload(
      session,
      item,
      gameId,
      interaction.user.id,
      notice,
    );
    await this.respondToImportInteraction(
      interaction,
      payload,
      ephemeral,
      context,
    );
  }

  private async buildCompletionatorAddFormPayload(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    gameId: number,
    ownerId: string,
    notice?: string,
  ): Promise<{ components: Array<ContainerBuilder | ActionRowBuilder<any>>; files: AttachmentBuilder[] }> {
    const platforms = await Game.getPlatformsForGameWithStandard(
      gameId,
      STANDARD_PLATFORM_IDS,
    );
    const state = this.getOrCreateCompletionatorAddFormState(
      session,
      item,
      gameId,
      ownerId,
    );
    if (!state.platformId && !state.otherPlatform && item.platformName) {
      const platformKey = item.platformName.trim().toLowerCase();
      const mappedNames = GAMEDB_CSV_PLATFORM_MAP[platformKey] ?? [];
      if (mappedNames.length) {
        const platformByName = new Map(
          platforms.map((platform) => [platform.name.toLowerCase(), platform.id]),
        );
        const matchingId = mappedNames
          .map((name) => platformByName.get(name.toLowerCase()))
          .find((id): id is number => Boolean(id));
        if (matchingId) {
          state.platformId = matchingId;
          state.otherPlatform = false;
        }
      }
    }
    const actionLines = this.buildCompletionatorActionLines(
      session,
      item,
      "Complete the form below to add this completion.",
    );
    if (notice) {
      actionLines.push("", notice);
    }
    if (!platforms.length) {
      return {
        components: this.buildCompletionatorComponents(
          [
            ...actionLines,
            "",
            "No platform release data is available for this game.",
          ],
        ),
        files: [],
      };
    }

    const mappedType = this.mapCompletionatorType(item.sourceType ?? undefined)
      ?? item.completionType
      ?? "Unknown";
    const { container, files, changeRow } =
      await this.buildCompletionatorExistingCompletionsContainer(
      ownerId,
      gameId,
      mappedType,
      session,
      item,
    );
    const rows = this.buildCompletionatorAddFormRows(state, item, platforms);
    return {
      components: this.buildCompletionatorComponents(
        actionLines,
        [...rows, changeRow],
        [container],
      ),
      files,
    };
  }

  private resolveCompletionatorDateChoice(
    state: CompletionatorAddFormState,
    item: ICompletionatorItem,
  ): Date | null {
    if (state.dateChoice === "csv") {
      return item.completedAt ?? null;
    }
    if (state.dateChoice === "today") {
      return new Date();
    }
    if (state.dateChoice === "date") {
      return state.customDate ?? null;
    }
    return null;
  }

  private async showCompletionatorDateModal(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(
        `comp-import-date:${interaction.user.id}:${session.importId}:${item.itemId}`,
      )
      .setTitle("Completion Date");
    const dateInput = new TextInputBuilder()
      .setCustomId("completion-date")
      .setLabel("Completion date (YYYY-MM-DD)")
      .setPlaceholder("2025-12-31")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(dateInput),
    );
    await interaction.showModal(modal);
  }

  private shouldConfirmCompletionMatch(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): boolean {
    if (!existing?.completedAt || !item.completedAt) {
      return false;
    }
    return formatTableDate(existing.completedAt) !== formatTableDate(item.completedAt);
  }

  private buildCompletionSameCheckLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): string[] {
    const currentDate = existing?.completedAt
      ? formatTableDate(existing.completedAt)
      : "Unknown";
    const csvDate = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return [
      `## Completionator Import #${session.importId}`,
      `Is this the same completion for "${item.gameTitle}"?`,
      "",
      `**Current:** ${existing?.completionType ?? "Unknown"} - ${currentDate} - ` +
        `${existing?.finalPlaytimeHours ?? "Unknown"} hrs`,
      `**CSV:** ${item.completionType ?? "Unknown"} - ${csvDate} - ` +
        `${item.playtimeHours ?? "Unknown"} hrs`,
      "",
      "**Action:** Yes = update existing. No = add as new completion.",
    ];
  }

  private buildCompletionUpdate(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): Partial<{
    completionType: string;
    completedAt: Date | null;
    finalPlaytimeHours: number | null;
  }> | null {
    if (!existing) return null;
    const updates: Partial<{
      completionType: string;
      completedAt: Date | null;
      finalPlaytimeHours: number | null;
    }> = {};

    if (item.completionType && item.completionType !== existing.completionType) {
      updates.completionType = item.completionType;
    }

    if (item.playtimeHours != null) {
      const existingPlaytime = existing.finalPlaytimeHours ?? null;
      if (existingPlaytime == null) {
        updates.finalPlaytimeHours = item.playtimeHours;
      } else if (Math.abs(existingPlaytime - item.playtimeHours) >= 1) {
        updates.finalPlaytimeHours = item.playtimeHours;
      }
    }

    if (item.completedAt) {
      const existingDate = existing.completedAt
        ? formatTableDate(existing.completedAt)
        : null;
      const incomingDate = formatTableDate(item.completedAt);
      if (!existingDate || existingDate !== incomingDate) {
        updates.completedAt = item.completedAt;
      }
    }

    return Object.keys(updates).length ? updates : null;
  }

  private buildCompletionatorUpdateLines(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): string[] {
    const currentDate = existing?.completedAt
      ? formatTableDate(existing.completedAt)
      : "Unknown";
    const csvDate = item.completedAt ? formatTableDate(item.completedAt) : "Unknown";
    return [
      `## Completionator Import #${session.importId}`,
      `Update existing completion for "${item.gameTitle}"?`,
      "",
      `**Current:** ${existing?.completionType ?? "Unknown"} - ${currentDate} - ` +
        `${existing?.finalPlaytimeHours ?? "Unknown"} hrs`,
      `**CSV:** ${item.completionType ?? "Unknown"} - ${csvDate} - ` +
        `${item.playtimeHours ?? "Unknown"} hrs`,
      "",
      "**Action:** Select fields to update.",
    ];
  }

  private buildCompletionUpdateOptions(
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    item: ICompletionatorItem,
  ): Array<{ label: string; value: string; description: string }> {
    const options: Array<{ label: string; value: string; description: string }> = [];
    const clamp = (value: string): string => value.slice(0, 95);

    if (item.completionType && item.completionType !== existing?.completionType) {
      options.push({
        label: "Completion Type",
        value: "type",
        description: clamp(`${existing?.completionType ?? "Unknown"} → ${item.completionType}`),
      });
    }

    if (item.completedAt) {
      const existingDate = existing?.completedAt
        ? formatTableDate(existing.completedAt)
        : "Unknown";
      const incomingDate = formatTableDate(item.completedAt);
      if (existingDate !== incomingDate) {
        options.push({
          label: "Completion Date",
          value: "date",
          description: clamp(`${existingDate} → ${incomingDate}`),
        });
      }
    }

    if (item.playtimeHours != null) {
      const existingPlaytime = existing?.finalPlaytimeHours ?? null;
      const delta = existingPlaytime == null
        ? null
        : Math.abs(existingPlaytime - item.playtimeHours);
      if (existingPlaytime == null || (delta != null && delta >= 1)) {
        options.push({
          label: "Playtime",
          value: "playtime",
          description: clamp(
            `${existingPlaytime ?? "Unknown"} hrs` +
              ` → ${item.playtimeHours} hrs`,
          ),
        });
      }
    }

    return options;
  }

  private async promptCompletionatorIgdbSelection(
    interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    initialQuery?: string,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const isComponent =
      "isMessageComponent" in interaction && interaction.isMessageComponent();
    if (!interaction.deferred && !interaction.replied) {
      if (isComponent) {
        await interaction.deferUpdate().catch(() => {});
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }

    const searchTerm = initialQuery?.trim() || item.gameTitle;

    while (true) {
      const searchingLines = [
        ...this.buildCompletionatorBaseLines(session, item),
        "",
        `Searching IGDB for "${searchTerm}"...`,
      ];
      await this.respondToImportInteraction(
        interaction,
        {
          components: this.buildCompletionatorComponents(searchingLines),
        },
        this.isInteractionEphemeral(interaction),
        context,
      );

      const igdbSearch = await igdbService.searchGames(searchTerm);
      if (igdbSearch.results.length) {
        const opts: IgdbSelectOption[] = igdbSearch.results.map((game) => {
          const year = game.first_release_date
            ? new Date(game.first_release_date * 1000).getFullYear()
            : "TBD";
          return {
            id: game.id,
            label: `${game.name} (${year})`,
            description: (game.summary || "No summary").slice(0, 95),
          };
        });

        const pauseButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:pause`,
          )
          .setLabel("Pause")
          .setStyle(ButtonStyle.Secondary);
        const skipButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:skip`,
          )
          .setLabel("Skip")
          .setStyle(ButtonStyle.Secondary);
        const queryButton = new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:igdb-query`,
          )
          .setLabel("New IGDB Search")
          .setStyle(ButtonStyle.Secondary);
        const extraRows = [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            pauseButton,
            skipButton,
            queryButton,
          ),
        ];

        const { components } = createIgdbSession(
          interaction.user.id,
          opts,
          async (sel, gameId) => {
            if (!sel.deferred && !sel.replied) {
              await sel.deferUpdate().catch(() => {});
            }
            await this.respondToImportInteraction(
              sel,
              {
                components: this.buildCompletionatorComponents([
                  ...this.buildCompletionatorBaseLines(session, item),
                  "",
                  "Importing game details from IGDB...",
                ]),
              },
              this.isInteractionEphemeral(sel),
              context,
            );

            const imported = await this.importGameFromIgdb(gameId);
            await this.handleCompletionatorMatch(
              sel,
              session,
              item,
              imported.gameId,
              this.isInteractionEphemeral(sel),
              context,
            );
          },
          extraRows,
        );

        const selectLines = [
          ...this.buildCompletionatorBaseLines(session, item),
          "",
          `Select an IGDB result to import for "${searchTerm}".`,
        ];
        await this.respondToImportInteraction(
          interaction,
          {
            components: this.buildCompletionatorComponents(selectLines, components),
          },
          this.isInteractionEphemeral(interaction),
          context,
        );
        return;
      }

      const actionLines = [
        ...this.buildCompletionatorBaseLines(session, item),
        "",
        `No IGDB matches found for "${searchTerm}".`,
        "Use the buttons below to search again, skip, or pause.",
      ];
      const retryButton = new ButtonBuilder()
        .setCustomId(
          `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:igdb-query`,
        )
        .setLabel("New IGDB Search")
        .setStyle(ButtonStyle.Secondary);
      const skipButton = new ButtonBuilder()
        .setCustomId(
          `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:skip`,
        )
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary);
      const pauseButton = new ButtonBuilder()
        .setCustomId(
          `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:pause`,
        )
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary);

      await this.respondToImportInteraction(
        interaction,
        {
          components: this.buildCompletionatorComponents(actionLines, [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              retryButton,
              skipButton,
              pauseButton,
            ),
          ]),
        },
        this.isInteractionEphemeral(interaction),
      );
      return;
    }
  }

  private stripCompletionatorYear(title: string): string {
    const trimmed: string = title.trim();
    return trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim();
  }

  private async searchGameDbWithFallback(
    rawTitle: string,
  ): Promise<Awaited<ReturnType<typeof Game.searchGames>>> {
    const primaryResults = await Game.searchGames(rawTitle);
    if (primaryResults.length) {
      return primaryResults;
    }

    const tokens = rawTitle
      .split(/\s+/)
      .map((token) => token.replace(/[^\p{L}\p{N}'-]/gu, ""))
      .filter((token) => token.length > 1);
    const uniqueTokens = Array.from(new Set(tokens));
    if (!uniqueTokens.length) {
      return [];
    }

    const resultMap = new Map<number, Awaited<ReturnType<typeof Game.searchGames>>[number]>();
    for (const token of uniqueTokens) {
      const matches = await Game.searchGames(token);
      for (const match of matches) {
        if (!resultMap.has(match.id)) {
          resultMap.set(match.id, match);
        }
      }
    }

    return Array.from(resultMap.values());
  }

  private async renderCompletionatorGameDbResults(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    results: Awaited<ReturnType<typeof Game.searchGames>>,
    baseLines: string[],
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    if (results.length === 1) {
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        results[0].id,
        ephemeral,
        context,
      );
      return;
    }

    const options = [
      {
        label: "Import another title from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      },
      ...results.slice(0, 23).map((game) => {
        const year = game.initialReleaseDate instanceof Date
          ? game.initialReleaseDate.getFullYear()
          : game.initialReleaseDate
            ? new Date(game.initialReleaseDate).getFullYear()
            : null;
        const platformNames = Array.from(new Set(
          (game.platforms ?? [])
            .map((platform) => formatPlatformDisplayName(platform.name) ?? platform.name)
            .filter((name) => Boolean(name)),
        ));
        platformNames.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
        const platformsLabel = platformNames.length
          ? platformNames.join(", ")
          : "Unknown platforms";
        const baseDescription = year ? `${year} - ${platformsLabel}` : platformsLabel;
        const description = baseDescription.length > 100
          ? `${baseDescription.slice(0, 97)}...`
          : baseDescription;
        return {
          label: game.title.slice(0, 100),
          value: String(game.id),
          description,
        };
      }),
      {
        label: `Skip (${COMPLETIONATOR_SKIP_SENTINEL})`,
        value: COMPLETIONATOR_SKIP_SENTINEL,
        description: "Skip this completion",
      },
    ];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`comp-import-select:${interaction.user.id}:${session.importId}:${item.itemId}`)
      .setPlaceholder("Select the matching game")
      .addOptions(options);

    const pauseButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:pause`,
      )
      .setLabel("Pause Import")
      .setStyle(ButtonStyle.Secondary);
    const skipButton = new ButtonBuilder()
      .setCustomId(
        `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:skip`,
      )
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary);

    const actionLines = [
      ...baseLines,
      "",
      "**Action:** Select the matching game.",
    ];
    await this.respondToImportInteraction(interaction, {
      components: this.buildCompletionatorComponents(actionLines, [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(pauseButton, skipButton),
      ]),
    }, ephemeral, context);
  }

  private buildCompletionatorNoMatchRows(
    userId: string,
    importId: number,
    itemId: number,
  ): ActionRowBuilder<ButtonBuilder>[] {
    const primaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:igdb`)
        .setLabel("Import from IGDB")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:igdb-manual`)
        .setLabel("Enter IGDB ID")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:query`)
        .setLabel("Query GameDB")
        .setStyle(ButtonStyle.Primary),
    );
    const secondaryRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:manual`)
        .setLabel("Enter GameDB ID")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`comp-import-action:${userId}:${importId}:${itemId}:pause`)
        .setLabel("Pause")
        .setStyle(ButtonStyle.Secondary),
    );
    return [primaryRow, secondaryRow];
  }

  private async respondToImportInteraction(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
    payload: {
      components: Array<ContainerBuilder | ActionRowBuilder<any>>;
      files?: any[];
    },
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const flags = buildComponentsV2Flags(Boolean(ephemeral));
    const files = payload.files ?? this.getCompletionatorAttachments();
    if (context?.message) {
      await context.message.edit({ ...payload, files, flags }).catch(() => {});
      return;
    }

    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ ...payload, files, flags });
      } else {
        await interaction.update({ ...payload, files, flags });
      }
      return;
    }

    await safeReply(interaction, {
      ...payload,
      files,
      flags,
    });
  }

  private isInteractionEphemeral(
    interaction:
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
  ): boolean {
    const message = "message" in interaction ? interaction.message : null;
    const flags = message?.flags;
    return Boolean(flags && flags.has(MessageFlags.Ephemeral));
  }

  private async showCompletionatorInputModal(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    kind: CompletionatorModalKind,
    title: string,
    label: string,
    placeholder: string,
    session: ICompletionatorImport,
    itemId: number,
    itemTitle?: string,
  ): Promise<void> {
    const modal = new ModalBuilder()
      .setCustomId(
        `comp-import-modal:${kind}:${interaction.user.id}:${session.importId}:${itemId}`,
      )
      .setTitle(title);
    const input = new TextInputBuilder()
      .setCustomId("completionator-input")
      .setLabel(label.slice(0, 45))
      .setPlaceholder((itemTitle ?? placeholder).slice(0, 100))
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
  }

  private async pauseCompletionatorImport(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    session: ICompletionatorImport,
  ): Promise<void> {
    await setImportStatus(session.importId, "PAUSED");
    await this.cleanupCompletionatorThread(session.userId, session.importId);
    await this.sendCompletionatorPausedNotice(interaction, session.importId);
  }

  private async sendCompletionatorPausedNotice(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    importId: number,
  ): Promise<void> {
    const content =
      `Import #${importId} paused. ` +
      "Resume with `/game-completion completionator-import action:resume`.";
    const payload = {
      content,
      flags: MessageFlags.Ephemeral,
    } as InteractionReplyOptions;

    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
      return;
    }

    await safeReply(interaction, payload);
  }

  private async cleanupCompletionatorThread(userId: string, importId: number): Promise<void> {
    const key = this.getCompletionatorThreadKey(userId, importId);
    const context = completionatorThreadContexts.get(key);
    if (!context) return;

    completionatorThreadContexts.delete(key);

    if (context.thread && "delete" in context.thread) {
      await context.thread.delete().catch(() => {});
    }
    if (context.parentMessage && "delete" in context.parentMessage) {
      await context.parentMessage.delete().catch(() => {});
    }
  }

  private getCompletionatorThreadKey(userId: string, importId: number): string {
    return `${userId}:${importId}`;
  }

  private async getOrCreateCompletionatorThread(
    interaction: CommandInteraction,
    session: ICompletionatorImport,
  ): Promise<CompletionatorThreadContext | null> {
    const ephemeral = interaction.channel?.id !== BOT_DEV_CHANNEL_ID;
    const key: string = this.getCompletionatorThreadKey(session.userId, session.importId);
    const existing: CompletionatorThreadContext | undefined =
      completionatorThreadContexts.get(key);
    if (existing) {
      return existing;
    }

    const channel: any = interaction.channel;
    if (!channel || typeof channel.send !== "function") {
      await safeReply(interaction, {
        content: "Cannot create a thread in this channel.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return null;
    }

    if (channel.id === BOT_DEV_CHANNEL_ID) {
      const introLines = [
        `<@${session.userId}>`,
        `## Completionator Import #${session.importId}`,
        "Preparing import...",
      ];
      const wizardMessage: Message = await channel.send({
        components: this.buildCompletionatorComponents(introLines),
        files: this.getCompletionatorAttachments(),
        flags: buildComponentsV2Flags(false),
      });
      const context: CompletionatorThreadContext = {
        userId: session.userId,
        importId: session.importId,
        threadId: channel.id,
        messageId: wizardMessage.id,
        thread: null,
        message: wizardMessage,
        parentMessage: null,
      };
      completionatorThreadContexts.set(key, context);
      return context;
    }

    if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
      const threadChannel: ThreadChannel = channel as ThreadChannel;
      const introLines = [
        `<@${session.userId}>`,
        `## Completionator Import #${session.importId}`,
        "Preparing import...",
      ];
      const wizardMessage: Message = await threadChannel.send({
        components: this.buildCompletionatorComponents(introLines),
        files: this.getCompletionatorAttachments(),
        flags: buildComponentsV2Flags(false),
      });

      const context: CompletionatorThreadContext = {
        userId: session.userId,
        importId: session.importId,
        threadId: threadChannel.id,
        messageId: wizardMessage.id,
        thread: threadChannel,
        message: wizardMessage,
        parentMessage: null,
      };
      completionatorThreadContexts.set(key, context);
      return context;
    }

    const parentMessage: Message = await channel.send({
      content: `Completionator Import #${session.importId} started by <@${session.userId}>.`,
    });
    if (typeof parentMessage.startThread !== "function") {
      await safeReply(interaction, {
        content: "Thread creation is not supported in this channel.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return null;
    }

    const threadName: string = `Completionator Import #${session.importId}`;
    const thread: ThreadChannel = await parentMessage.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 60,
    });

    const introLines = [
      `<@${session.userId}>`,
      `## Completionator Import #${session.importId}`,
      "Preparing import...",
    ];
    const wizardMessage: Message = await thread.send({
      components: this.buildCompletionatorComponents(introLines),
      files: this.getCompletionatorAttachments(),
      flags: buildComponentsV2Flags(false),
    });

    const context: CompletionatorThreadContext = {
      userId: session.userId,
      importId: session.importId,
      threadId: thread.id,
      messageId: wizardMessage.id,
      thread: thread,
      message: wizardMessage,
      parentMessage: parentMessage,
    };
    completionatorThreadContexts.set(key, context);
    return context;
  }

  private async buildCompletionEmbed(
    userId: string,
    page: number,
    year: number | "unknown" | null,
    interactionUser: User,
    query?: string,
  ): Promise<{
    embed: EmbedBuilder;
    total: number;
    totalPages: number;
    safePage: number;
    pageCompletions: any[];
  } | null> {
    const total = await Member.countCompletions(userId, year, query);
    if (total === 0) return null;

    const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * COMPLETION_PAGE_SIZE;

    const allCompletions = await Member.getCompletions({
      userId,
      limit: 1000,
      offset: 0,
      year,
      title: query,
    });
    const platforms = await Game.getAllPlatforms();
    const platformMap = new Map(
      platforms.map((platform) => [platform.id, platform.abbreviation ?? platform.name]),
    );

    allCompletions.sort((a, b) => {
      const yearA = a.completedAt ? a.completedAt.getFullYear() : null;
      const yearB = b.completedAt ? b.completedAt.getFullYear() : null;

      if (yearA == null && yearB == null) {
        return a.title.localeCompare(b.title);
      }
      if (yearA == null) return 1;
      if (yearB == null) return -1;
      if (yearA !== yearB) {
        return yearB - yearA;
      }

      const dateA = a.completedAt ? a.completedAt.getTime() : 0;
      const dateB = b.completedAt ? b.completedAt.getTime() : 0;
      return dateA - dateB;
    });

    if (!allCompletions.length) return null;

    const yearCounts: Record<string, number> = {};
    const yearIndices = new Map<number, number>();

    for (const c of allCompletions) {
      const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
      yearCounts[yr] = (yearCounts[yr] ?? 0) + 1;
      yearIndices.set(c.completionId, yearCounts[yr]);
    }

    const pageCompletions = allCompletions.slice(offset, offset + COMPLETION_PAGE_SIZE);
    const dateWidth = 10;
    const maxIndexLabelLength =
      String(Math.max(...pageCompletions.map((c) => yearIndices.get(c.completionId) ?? 0)))
        .length + 1;

    const grouped = pageCompletions.reduce<Record<string, string[]>>((acc, c) => {
      const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
      acc[yr] = acc[yr] || [];

      const yearIdx = yearIndices.get(c.completionId)!;
      const idxLabelRaw = `${yearIdx}.`;
      const idxLabel = idxLabelRaw.padStart(maxIndexLabelLength, " ");
      const dateLabel = c.completedAt
        ? formatTableDate(c.completedAt).padStart(dateWidth, " ")
        : "";

      const typeAbbrev =
        c.completionType === "Main Story"
          ? "M"
          : c.completionType === "Main Story + Side Content"
            ? "M+S"
            : "C";

      const idxBlock = `\`${idxLabel}\``;
      const dateBlock = dateLabel ? `\`${dateLabel}\`` : "";
      const rawPlatformName = c.platformId == null
        ? null
        : platformMap.get(c.platformId) ?? "Unknown Platform";
      const platformName = formatPlatformDisplayName(rawPlatformName);
      const platformLabel = platformName ? ` [${platformName}]` : "";
      const line = `${idxBlock} ${dateBlock} **${c.title}**${platformLabel} (${typeAbbrev})`
        .replace(
          /\s{2,}/g,
          " ",
        );
      acc[yr].push(line);
      if (c.note) {
        acc[yr].push(`> ${c.note}`);
      }
      return acc;
    }, {});

    const authorName = interactionUser.displayName ?? interactionUser.username ?? "User";
    const authorIcon = interactionUser.displayAvatarURL?.({
      size: 64,
      forceStatic: false,
    });
    const embed = new EmbedBuilder().setTitle(`${authorName}'s Completed Games (${total} total)`);
    const queryLabel = query?.trim();
    if (queryLabel) {
      embed.setDescription(`Filter: "${queryLabel}"`);
    }

    embed.setAuthor({
      name: authorName,
      iconURL: authorIcon ?? undefined,
    });

    const sortedYears = Object.keys(grouped).sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return Number(b) - Number(a);
    });

    const addChunkedField = (yr: string, content: string, chunkIndex: number): void => {
      let name = "";
      if (chunkIndex === 0) {
        const count = yearCounts[yr] ?? 0;
        const displayYear = yr === "Unknown" ? "Unknown Date" : yr;
        name = `${displayYear} (${count})`;
      }
      embed.addFields({ name, value: content || "None", inline: false });
    };

    for (const yr of sortedYears) {
    const lines = grouped[yr];
      if (!lines || !lines.length) {
        addChunkedField(yr, "None", 0);
        continue;
      }

      let buffer = "";
      let chunkIndex = 0;
      const flush = (): void => {
        if (buffer) {
          addChunkedField(yr, buffer, chunkIndex);
          chunkIndex++;
          buffer = "";
        }
      };

      for (const line of lines) {
        const next = buffer ? `${buffer}\n${line}` : line;
        if (next.length > 1000) {
          flush();
          buffer = line;
        } else {
          buffer = next;
        }
      }
      flush();
    }

    const footerLines = ["M = Main Story • M+S = Main Story + Side Content • C = Completionist"];
    if (totalPages > 1) {
      footerLines.push(`${total} results. Page ${safePage + 1} of ${totalPages}.`);
    }
    embed.setFooter({ text: footerLines.join("\n") });

    return {
      embed,
      total,
      totalPages,
      safePage,
      pageCompletions,
    };
  }

  private async renderCompletionPage(
    interaction:
      | CommandInteraction
      | ButtonInteraction
      | StringSelectMenuInteraction
      | ModalSubmitInteraction,
    userId: string,
    page: number,
    year: number | "unknown" | null,
    ephemeral: boolean,
    query?: string,
  ): Promise<void> {
    const user =
      interaction.user.id === userId
        ? interaction.user
        : await interaction.client.users.fetch(userId).catch(() => interaction.user);

    const result = await this.buildCompletionEmbed(userId, page, year, user, query);

    if (!result) {
      if (year === "unknown") {
        await safeReply(interaction as any, {
          content: "You have no recorded completions with unknown dates.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }
      await safeReply(interaction as any, {
        content: year
          ? `You have no recorded completions for ${year}.`
          : "You have no recorded completions yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const { embed, totalPages, safePage } = result;

    const yearPart = year == null ? "" : String(year);
    const queryPart = query ? `:${query.slice(0, 50)}` : "";
    const components: any[] = [];

    if (totalPages > 1) {
      const options = [];
      const maxOptions = 25;
      let startPage = 0;
      let endPage = totalPages - 1;

      if (totalPages > maxOptions) {
        const half = Math.floor(maxOptions / 2);
        startPage = Math.max(0, safePage - half);
        endPage = Math.min(totalPages - 1, startPage + maxOptions - 1);
        startPage = Math.max(0, endPage - maxOptions + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
        options.push({
          label: `Page ${i + 1}`,
          value: String(i),
          default: i === safePage,
        });
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`comp-page-select:${userId}:${yearPart}:list${queryPart}`)
        .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
        .addOptions(options);

      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

      const prevDisabled = safePage <= 0;
      const nextDisabled = safePage >= totalPages - 1;

      const prev = new ButtonBuilder()
        .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled);
      const next = new ButtonBuilder()
        .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:next${queryPart}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled);

      if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
      }
    }

    await safeReply(interaction as any, {
      embeds: [embed],
      components,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async renderSelectionPage(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    userId: string,
    page: number,
    mode: "edit" | "delete",
    year: number | "unknown" | null = null,
    query?: string,
  ): Promise<void> {
    const user =
      interaction.user.id === userId
        ? interaction.user
        : await interaction.client.users.fetch(userId).catch(() => interaction.user);

    const result = await this.buildCompletionEmbed(userId, page, year, user, query);

    if (!result) {
      const msg =
        mode === "edit"
          ? "You have no completions to edit matching your filters."
          : "You have no completions to delete matching your filters.";
      if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
      } else {
        await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    const { embed, totalPages, safePage, pageCompletions } = result;

    const selectOptions = pageCompletions.map((c) => ({
      label: c.title.slice(0, 100),
      value: String(c.completionId),
      description: `${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`.slice(
        0,
        100,
      ),
    }));

    const selectId = mode === "edit" ? "comp-edit-menu" : "comp-del-menu";
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${selectId}:${userId}`)
      .setPlaceholder(`Select a completion to ${mode}`)
      .addOptions(selectOptions);

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const queryPart = query ? `:${query.slice(0, 50)}` : "";
    const components: any[] = [selectRow];

    if (totalPages > 1) {
      const options = [];
      const maxOptions = 25;
      let startPage = 0;
      let endPage = totalPages - 1;

      if (totalPages > maxOptions) {
        const half = Math.floor(maxOptions / 2);
        startPage = Math.max(0, safePage - half);
        endPage = Math.min(totalPages - 1, startPage + maxOptions - 1);
        startPage = Math.max(0, endPage - maxOptions + 1);
      }

      for (let i = startPage; i <= endPage; i++) {
        options.push({
          label: `Page ${i + 1}`,
          value: String(i),
          default: i === safePage,
        });
      }

      const yearPart = year == null ? "" : String(year);
      const pageSelect = new StringSelectMenuBuilder()
        .setCustomId(`comp-page-select:${userId}:${yearPart}:${mode}${queryPart}`)
        .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
        .addOptions(options);

      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pageSelect));

      const prevDisabled = safePage <= 0;
      const nextDisabled = safePage >= totalPages - 1;

      const prev = new ButtonBuilder()
        .setCustomId(`comp-${mode}-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled);
      const next = new ButtonBuilder()
        .setCustomId(`comp-${mode}-page:${userId}:${yearPart}:${safePage}:next${queryPart}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled);

      if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
        components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
      }
    }

    if (interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components });
      } else {
        await interaction.update({ embeds: [embed], components });
      }
    } else {
      await safeReply(interaction, {
        embeds: [embed],
        components,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async promptCompletionSelection(
    interaction: CommandInteraction,
    searchTerm: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
    const localResults = await Game.searchGames(searchTerm);
    if (localResults.length) {
      const sessionId = this.createCompletionSession(ctx);
      const options = localResults.slice(0, 24).map((game) => ({
        label: game.title.slice(0, 100),
        value: String(game.id),
        description: `GameDB #${game.id}`,
      }));

      options.push({
        label: "Import another game from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId(`completion-add-select:${sessionId}`)
        .setPlaceholder("Select a game to log completion")
        .addOptions(options);

      await safeReply(interaction, {
        content: `Select the game for "${searchTerm}".`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.promptIgdbSelection(interaction, searchTerm, ctx);
  }

  private async promptIgdbSelection(
    interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
    searchTerm: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
    if (interaction.isMessageComponent()) {
      const loading = { content: `Searching IGDB for "${searchTerm}"...`, components: [] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(loading);
      } else {
        await interaction.update(loading);
      }
    }

    const igdbSearch = await igdbService.searchGames(searchTerm);
    if (!igdbSearch.results.length) {
      const content = `No GameDB or IGDB matches found for "${searchTerm}" (len: ${searchTerm.length}).`;
      if (interaction.isMessageComponent()) {
        await interaction.editReply({ content, components: [] });
      } else {
        await safeReply(interaction, {
          content,
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const opts: IgdbSelectOption[] = igdbSearch.results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").slice(0, 95),
      };
    });

    const { components } = createIgdbSession(
      interaction.user.id,
      opts,
      async (sel, gameId) => {
        if (!sel.deferred && !sel.replied) {
          await sel.deferUpdate().catch(() => {});
        }
        await sel.editReply({
          content: "Importing game details from IGDB...",
          components: [],
        }).catch(() => {});

        const imported = await this.importGameFromIgdb(gameId);
        const referenceDate = ctx.completedAt ?? new Date();
        const recent = await Member.getRecentCompletionForGame(
          ctx.userId,
          imported.gameId,
          referenceDate,
        );
        if (recent) {
          const confirmed = await this.confirmDuplicateCompletion(
            sel,
            imported.title,
            recent,
          );
          if (!confirmed) {
            return;
          }
        }
        const removeFromNowPlaying = await resolveNowPlayingRemoval(
          sel,
          ctx.userId,
          imported.gameId,
          imported.title,
          ctx.completedAt,
          false,
        );
        await this.promptCompletionPlatformSelection(sel, {
          userId: ctx.userId,
          gameId: imported.gameId,
          gameTitle: imported.title,
          completionType: ctx.completionType,
          completedAt: ctx.completedAt,
          finalPlaytimeHours: ctx.finalPlaytimeHours,
          note: ctx.note,
          announce: ctx.announce,
          removeFromNowPlaying,
        });
      },
    );

    const content = `No GameDB match; select an IGDB result to import for "${searchTerm}".`;
    if (interaction.isMessageComponent()) {
      await interaction.editReply({
        content: "Found results on IGDB. Please see the new message below.",
        components: [],
      });
      await interaction.followUp({ content, components, flags: MessageFlags.Ephemeral });
    } else {
      await safeReply(interaction, {
        content,
        components,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async processCompletionSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
    ctx: CompletionAddContext,
  ): Promise<boolean> {
    if (value === "import-igdb") {
      if (!ctx.query) {
        await interaction.reply({
          content: "Original search query lost. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }
      await this.promptIgdbSelection(interaction, ctx.query, ctx);
      return true;
    }

    if (!interaction.deferred && !interaction.replied) {
      try {
        await interaction.deferUpdate();
      } catch {
        // ignore
      }
    }

    try {
      let gameId: number | null = null;
      let gameTitle: string | null = null;

      if (value.startsWith("igdb:")) {
        const igdbId = Number(value.split(":")[1]);
        if (!Number.isInteger(igdbId) || igdbId <= 0) {
          await interaction.followUp({
            content: "Invalid IGDB selection.",
            flags: MessageFlags.Ephemeral,
          });
          return false;
        }
        const imported = await this.importGameFromIgdb(igdbId);
        gameId = imported.gameId;
        gameTitle = imported.title;
      } else {
        const parsedId = Number(value);
        if (!Number.isInteger(parsedId) || parsedId <= 0) {
          await interaction.followUp({
            content: "Invalid selection.",
            flags: MessageFlags.Ephemeral,
          });
          return false;
        }
        const game = await Game.getGameById(parsedId);
        if (!game) {
          await interaction.followUp({
            content: "Selected game was not found in GameDB.",
            flags: MessageFlags.Ephemeral,
          });
          return false;
        }
        gameId = game.id;
        gameTitle = game.title;
      }

      if (!gameId) {
        await interaction.followUp({
          content: "Could not determine a game to log.",
          flags: MessageFlags.Ephemeral,
        });
        return false;
      }

      const referenceDate = ctx.completedAt ?? new Date();
      const recent = await Member.getRecentCompletionForGame(
        ctx.userId,
        gameId,
        referenceDate,
      );
      if (recent) {
        const confirmed = await this.confirmDuplicateCompletion(
          interaction,
          gameTitle ?? "this game",
          recent,
        );
        if (!confirmed) {
          return false;
        }
      }

      const removeFromNowPlaying = await resolveNowPlayingRemoval(
        interaction,
        ctx.userId,
        gameId,
        gameTitle ?? "this game",
        ctx.completedAt,
        false,
      );
      await this.promptCompletionPlatformSelection(interaction, {
        userId: ctx.userId,
        gameId,
        gameTitle: gameTitle ?? "this game",
        completionType: ctx.completionType,
        completedAt: ctx.completedAt,
        finalPlaytimeHours: ctx.finalPlaytimeHours,
        note: ctx.note,
        announce: ctx.announce,
        removeFromNowPlaying,
      });
      return false;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await interaction.followUp({
        content: `Failed to add completion: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
      return false;
    }
  }

  private async importGameFromIgdb(igdbId: number): Promise<{ gameId: number; title: string }> {
    const existing = await Game.getGameByIgdbId(igdbId);
    if (existing) {
      return { gameId: existing.id, title: existing.title };
    }

    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      throw new Error("Failed to load game details from IGDB.");
    }

    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        imageData = Buffer.from(imageResponse.data);
      } catch (err) {
        console.error("Failed to download cover image:", err);
      }
    }

    const newGame = await Game.createGame(
      details.name,
      details.summary ?? "",
      imageData,
      details.id,
      details.slug ?? null,
      details.total_rating ?? null,
      details.url ?? null,
      Game.getFeaturedVideoUrl(details),
    ).catch(async (err: any) => {
      const message = String(err?.message ?? "");
      if (!message.includes("ORA-00001")) {
        throw err;
      }

      const matches = await Game.searchGames(details.name);
      const exact = matches.find(
        (game) => game.title.toLowerCase() === details.name.toLowerCase(),
      );
      if (exact) {
        return { id: exact.id, title: exact.title } as any;
      }
      throw err;
    });
    await Game.saveFullGameMetadata(newGame.id, details);
    return { gameId: newGame.id, title: details.name };
  }
}

function escapeCsv(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
