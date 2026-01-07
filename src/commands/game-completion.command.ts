import {
  ApplicationCommandOptionType,
  type Attachment,
  type CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  type Message,
  type ThreadChannel,
  AttachmentBuilder,
  type User,
  type InteractionReplyOptions,
} from "discord.js";
import axios from "axios";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
  SelectMenuComponent,
  ButtonComponent,
  SlashChoice,
} from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game from "../classes/Game.js";
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
import { saveCompletion } from "../functions/CompletionHelpers.js";

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
const COMPLETIONATOR_SKIP_SENTINEL = "skip";
const COMPLETIONATOR_PAUSE_SENTINEL = "pause";
const COMPLETIONATOR_STATUS_OPTIONS = ["start", "resume", "status", "pause", "cancel"] as const;

type CompletionatorAction = (typeof COMPLETIONATOR_STATUS_OPTIONS)[number];
type CompletionatorThreadContext = {
  userId: string;
  importId: number;
  threadId: string;
  messageId: string;
  thread: ThreadChannel;
  message: Message;
  parentMessage: Message | null;
};

const completionatorThreadContexts: Map<string, CompletionatorThreadContext> = new Map();

@Discord()
@SlashGroup({ description: "Manage game completions", name: "game-completion" })
@SlashGroup("game-completion")
export class GameCompletionCommands {
  private readonly maxNoteLength = 500;

  @Slash({ description: "Add a game completion", name: "add" })
  async completionAdd(
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
      description: "GameDB id (optional if using title)",
      name: "game_id",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    gameId: number | undefined,
    @SlashOption({
      description: "Search text to find/import the game",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
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

    if (gameId) {
      const game = await Game.getGameById(Number(gameId));
      if (!game) {
        await safeReply(interaction, {
          content: `GameDB #${gameId} was not found.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await saveCompletion(
        interaction,
        userId,
        game.id,
        completionType,
        completedAt,
        playtime,
        trimmedNote,
        game.title,
        announce,
      );
      return;
    }

    const searchTerm = (query ?? "").trim();
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Provide a game_id or include a search query.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.promptCompletionSelection(interaction, searchTerm, {
      userId,
      completionType,
      completedAt,
      finalPlaytimeHours: playtime,
      note: trimmedNote,
      source: "existing",
      query: searchTerm,
      announce,
    });
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

    if (showAll) {
      await this.renderCompletionLeaderboard(interaction, ephemeral, query);
      return;
    }

    let yearFilter: number | "unknown" | null = null;
    if (yearRaw) {
      const trimmed = yearRaw.trim();
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
    await this.renderCompletionPage(interaction, targetUserId, 0, yearFilter, ephemeral, query);
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
    await this.renderSelectionPage(
      interaction,
      interaction.user.id,
      0,
      "edit",
      year ?? null,
      query,
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
    await this.renderSelectionPage(
      interaction,
      interaction.user.id,
      0,
      "delete",
      null,
      query,
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

      const completionId = await Member.addCompletion({
        userId: interaction.user.id,
        gameId: item.gameDbGameId,
        completionType: item.completionType ?? "Main Story",
        completedAt: item.completedAt,
        finalPlaytimeHours: item.playtimeHours,
        note: null,
      });
      await Member.removeNowPlaying(interaction.user.id, item.gameDbGameId).catch(() => {});

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

      const completionId = await Member.addCompletion({
        userId: interaction.user.id,
        gameId: item.gameDbGameId,
        completionType: item.completionType ?? "Main Story",
        completedAt: item.completedAt,
        finalPlaytimeHours: item.playtimeHours,
        note: null,
      });
      await Member.removeNowPlaying(interaction.user.id, item.gameDbGameId).catch(() => {});

      await updateImportItem(item.itemId, {
        status: "IMPORTED",
        gameDbGameId: item.gameDbGameId,
        completionId,
      });
      await this.processNextCompletionatorItem(interaction, session);
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

      await this.promptCompletionatorIgdbSelection(interaction, session, item);
      return;
    }

    if (action === "igdb-query") {
      const item = await getImportItemById(itemId);
      if (!item) {
        await interaction.reply({
          content: "Import item not found.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
      }

      await this.editImportPrompt(
        interaction,
        `Enter a new IGDB search string for "${item.gameTitle}".`,
      );

      const response = await this.promptCompletionatorText(interaction);
      if (!response) return;

      if (response === COMPLETIONATOR_PAUSE_SENTINEL) {
        await this.pauseCompletionatorImport(interaction, session);
        return;
      }

      if (response === COMPLETIONATOR_SKIP_SENTINEL) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      await this.promptCompletionatorIgdbSelection(interaction, session, item, response);
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

      await this.editImportPrompt(
        interaction,
        `Enter the IGDB id for "${item.gameTitle}".`,
      );

      const response = await this.promptCompletionatorText(interaction);
      if (!response) return;

      if (response === COMPLETIONATOR_PAUSE_SENTINEL) {
        await this.pauseCompletionatorImport(interaction, session);
        return;
      }

      if (response === COMPLETIONATOR_SKIP_SENTINEL) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      const igdbId = Number(response);
      if (!Number.isInteger(igdbId) || igdbId <= 0) {
        await updateImportItem(item.itemId, {
          status: "ERROR",
          errorText: "Invalid IGDB id entered.",
        });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      const imported = await this.importGameFromIgdb(igdbId);
      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        imported.gameId,
        this.isInteractionEphemeral(interaction),
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

      await this.editImportPrompt(
        interaction,
        `Enter a GameDB search string for "${item.gameTitle}".`,
      );
      await this.promptCompletionatorGameDbSearch(interaction, session, item, ephemeral);
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

      await this.editImportPrompt(
        interaction,
        `Enter the GameDB id for "${item.gameTitle}".`,
      );

      const response = await this.promptCompletionatorText(interaction);
      if (!response) return;

      if (response === COMPLETIONATOR_PAUSE_SENTINEL) {
        await this.pauseCompletionatorImport(interaction, session);
        return;
      }

      if (response === COMPLETIONATOR_SKIP_SENTINEL) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      const manualId = Number(response);
      if (!Number.isInteger(manualId) || manualId <= 0) {
        await updateImportItem(item.itemId, {
          status: "ERROR",
          errorText: "Invalid GameDB id entered.",
        });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      await this.handleCompletionatorMatch(
        interaction,
        session,
        item,
        manualId,
        this.isInteractionEphemeral(interaction),
      );
      return;
    }

    if (action === "pause") {
      await this.pauseCompletionatorImport(interaction, session);
      return;
    }

    if (action === "skip") {
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
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const userId = interaction.user.id;

    if (action === "start") {
      if (!file?.url) {
        await safeReply(interaction, {
          content: "Please attach the Completionator CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const csvText = await this.fetchCsv(file.url);
      if (!csvText) {
        await safeReply(interaction, {
          content: "Failed to download the CSV file.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const parsed = this.parseCompletionatorCsv(csvText);
      if (!parsed.length) {
        await safeReply(interaction, {
          content: "No rows found in the CSV file.",
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = await getActiveImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active import session found.",
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
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
    if (normalized === "Core Game (+ A Few Extras)") return "Main Story";
    if (normalized === "Core Game (+ Lots of Extras)") return "Main Story + Side Content";
    if (normalized === "Completionated") return "Completionist";
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
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    options?: { ephemeral?: boolean; context?: CompletionatorThreadContext },
  ): Promise<void> {
    const nextItem = await getNextPendingItem(session.importId);
    if (!nextItem) {
      await setImportStatus(session.importId, "COMPLETED");
      await this.respondToImportInteraction(interaction, {
        content: `Import #${session.importId} completed.`,
        components: [],
        embeds: [],
        files: [],
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

  private buildCompletionatorEmbed(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`Completionator Import #${session.importId}`)
      .setDescription(`Row ${item.rowIndex} of ${session.totalCount}`)
      .addFields(
        { name: "Title", value: item.gameTitle, inline: false },
        { name: "Platform", value: item.platformName ?? "Unknown", inline: true },
        { name: "Region", value: item.regionName ?? "Unknown", inline: true },
        { name: "Type", value: item.sourceType ?? "Unknown", inline: true },
        { name: "Mapped", value: item.completionType ?? "Unknown", inline: true },
        { name: "Playtime", value: item.timeText ?? "Unknown", inline: true },
        {
          name: "Completed",
          value: item.completedAt ? formatTableDate(item.completedAt) : "Unknown",
          inline: true,
        },
      );
    return embed;
  }

  private async renderCompletionatorItem(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const searchTitle = this.stripCompletionatorYear(item.gameTitle);
    const results = await this.searchGameDbWithFallback(searchTitle);
    const embed = this.buildCompletionatorEmbed(session, item);

    if (!results.length) {
      const content =
        `No GameDB matches found for "${item.gameTitle}". ` +
        "Choose an option below.";
      const actionEmbed = this.buildCompletionatorActionEmbed(
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
        embeds: [actionEmbed],
        components: rows,
        content,
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
      embed,
      ephemeral,
      context,
    );
  }

  private async handleCompletionatorMatch(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
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
      const actionEmbed = this.buildCompletionatorActionEmbed(
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
        content: `GameDB id ${gameId} was not found. Choose another option below.`,
        embeds: [actionEmbed],
        components: rows,
      }, ephemeral, context);
      return;
    }

    const existing = await Member.getCompletionByGameId(interaction.user.id, gameId);
    if (!existing) {
      await updateImportItem(item.itemId, {
        gameDbGameId: gameId,
      });

      const actionText = `Add completion (${item.completionType ?? "Main Story"})`;
      const embed = this.buildCompletionatorActionEmbed(session, item, actionText);
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `comp-import-action:${interaction.user.id}:${session.importId}:${item.itemId}:add`,
          )
          .setLabel("Add Completion")
          .setStyle(ButtonStyle.Success),
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

      await this.respondToImportInteraction(interaction, {
        embeds: [embed],
        components: [buttons],
        content: "",
      }, ephemeral, context);
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
      const confirmEmbed = this.buildCompletionSameCheckEmbed(session, item, existing);
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
        embeds: [confirmEmbed],
        components: [confirmButtons],
        content: "",
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
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    const embed = this.buildCompletionUpdateEmbed(session, item, existing);
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

    await this.respondToImportInteraction(interaction, {
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(updateSelect),
        buttons,
      ],
      content: "",
    }, ephemeral, context);
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

  private buildCompletionSameCheckEmbed(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`Completionator Import #${session.importId}`)
      .setDescription(`Is this the same completion for "${item.gameTitle}"?`)
      .addFields(
        {
          name: "Current",
          value:
            `${existing?.completionType ?? "Unknown"} — ` +
            `${existing?.completedAt ? formatTableDate(existing.completedAt) : "Unknown"} — ` +
            `${existing?.finalPlaytimeHours ?? "Unknown"} hrs`,
        },
        {
          name: "CSV",
          value:
            `${item.completionType ?? "Unknown"} — ` +
            `${item.completedAt ? formatTableDate(item.completedAt) : "Unknown"} — ` +
            `${item.playtimeHours ?? "Unknown"} hrs`,
        },
        {
          name: "Action",
          value: "Yes = update existing, No = add as new completion",
          inline: false,
        },
      );
    return embed;
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

  private buildCompletionUpdateEmbed(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    existing: Awaited<ReturnType<typeof Member.getCompletionByGameId>>,
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(`Completionator Import #${session.importId}`)
      .setDescription(`Update existing completion for "${item.gameTitle}"?`)
      .addFields(
        {
          name: "Current",
          value:
            `${existing?.completionType ?? "Unknown"} — ` +
            `${existing?.completedAt ? formatTableDate(existing.completedAt) : "Unknown"} — ` +
            `${existing?.finalPlaytimeHours ?? "Unknown"} hrs`,
        },
        {
          name: "CSV",
          value:
            `${item.completionType ?? "Unknown"} — ` +
            `${item.completedAt ? formatTableDate(item.completedAt) : "Unknown"} — ` +
            `${item.playtimeHours ?? "Unknown"} hrs`,
        },
        { name: "Action", value: "Select fields to update", inline: false },
      );
    return embed;
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
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    initialQuery?: string,
  ): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }

    let searchTerm = initialQuery?.trim() || item.gameTitle;

    while (true) {
      await interaction.editReply({
        content: `Searching IGDB for "${searchTerm}"...`,
        components: [],
      }).catch(() => {});

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
            await sel.editReply({
              content: "Importing game details from IGDB...",
              components: [],
            }).catch(() => {});

            const imported = await this.importGameFromIgdb(gameId);
            await this.handleCompletionatorMatch(
              sel,
              session,
              item,
              imported.gameId,
              this.isInteractionEphemeral(sel),
            );
          },
          extraRows,
        );

        await interaction.editReply({
          content: `Select an IGDB result to import for "${searchTerm}".`,
          components,
        }).catch(() => {});
        return;
      }

      await this.editImportPrompt(
        interaction,
        `No IGDB matches found for "${searchTerm}". ` +
          `Reply with a new search string, "${COMPLETIONATOR_SKIP_SENTINEL}" to skip, ` +
          `or "${COMPLETIONATOR_PAUSE_SENTINEL}" to pause.`,
      );

      const response = await this.promptCompletionatorText(interaction);
      if (!response) return;

      if (response === COMPLETIONATOR_PAUSE_SENTINEL) {
        await this.pauseCompletionatorImport(interaction, session);
        return;
      }

      if (response === COMPLETIONATOR_SKIP_SENTINEL) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session);
        return;
      }

      searchTerm = response;
    }
  }

  private async promptCompletionatorGameDbSearch(
    interaction: ButtonInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    ephemeral: boolean,
  ): Promise<void> {
    while (true) {
      const response = await this.promptCompletionatorText(interaction);
      if (!response) return;

      if (response === COMPLETIONATOR_PAUSE_SENTINEL) {
        await this.pauseCompletionatorImport(interaction, session);
        return;
      }

      if (response === COMPLETIONATOR_SKIP_SENTINEL) {
        await updateImportItem(item.itemId, { status: "SKIPPED" });
        await this.processNextCompletionatorItem(interaction, session, { ephemeral });
        return;
      }

      const normalized = this.stripCompletionatorYear(response);
      const results = await this.searchGameDbWithFallback(normalized);
      if (!results.length) {
        await this.editImportPrompt(
          interaction,
          `No GameDB matches found for "${response}". ` +
            `Reply with a new search string, "${COMPLETIONATOR_SKIP_SENTINEL}" to skip, ` +
            `or "${COMPLETIONATOR_PAUSE_SENTINEL}" to pause.`,
        );
        continue;
      }

      const embed = this.buildCompletionatorEmbed(session, item);
      await this.renderCompletionatorGameDbResults(
        interaction,
        session,
        item,
        results,
        embed,
        ephemeral,
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
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    results: Awaited<ReturnType<typeof Game.searchGames>>,
    embed: EmbedBuilder,
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

    const options = results.slice(0, 23).map((game) => ({
      label: game.title.slice(0, 100),
      value: String(game.id),
      description: `GameDB #${game.id}`,
    }));

    options.push({
      label: "Import another title from IGDB",
      value: "import-igdb",
      description: "Search IGDB and import a new GameDB entry",
    });

    options.push({
      label: `Skip (${COMPLETIONATOR_SKIP_SENTINEL})`,
      value: COMPLETIONATOR_SKIP_SENTINEL,
      description: "Skip this completion",
    });

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

    await this.respondToImportInteraction(interaction, {
      embeds: [embed],
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(pauseButton, skipButton),
      ],
      content: "",
    }, ephemeral, context);
  }

  private buildCompletionatorActionEmbed(
    session: ICompletionatorImport,
    item: ICompletionatorItem,
    actionText: string,
  ): EmbedBuilder {
    const embed = this.buildCompletionatorEmbed(session, item).addFields({
      name: "Action",
      value: actionText,
      inline: false,
    });
    return embed;
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
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    payload: {
      content?: string;
      embeds?: EmbedBuilder[];
      components?: any[];
      files?: any[];
    },
    ephemeral?: boolean,
    context?: CompletionatorThreadContext,
  ): Promise<void> {
    if (context?.message) {
      await context.message.edit(payload).catch(() => {});
      return;
    }

    if ("isMessageComponent" in interaction && interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        await interaction.update(payload);
      }
      return;
    }

    await safeReply(interaction, {
      ...payload,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private isInteractionEphemeral(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
  ): boolean {
    const flags = interaction.message?.flags;
    return Boolean(flags && flags.has(MessageFlags.Ephemeral));
  }

  private async editImportPrompt(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    content: string,
  ): Promise<void> {
    const payload = {
      content,
      components: [],
      embeds: interaction.message?.embeds?.length ? interaction.message.embeds : undefined,
      attachments: [],
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.update(payload).catch(() => {});
    }
  }

  private async promptCompletionatorText(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  ): Promise<string | null> {
    const channel: any = interaction.channel;
    const userId = interaction.user.id;
    const ephemeral = interaction.isMessageComponent()
      ? this.isInteractionEphemeral(interaction)
      : true;

    if (!channel || typeof channel.awaitMessages !== "function") {
      if (interaction.isMessageComponent()) {
        await this.editImportPrompt(interaction, "Cannot prompt for input in this channel.");
      } else {
        await safeReply(interaction, {
          content: "Cannot prompt for input in this channel.",
          flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
      }
      return null;
    }

    const collected = await channel.awaitMessages({
      filter: (m: Message) => m.author?.id === userId,
      max: 1,
      time: 120_000,
    }).catch(() => null);

    const message = collected?.first();
    if (!message) return null;

    const content = message.content.trim().toLowerCase();
    await message.delete().catch(() => {});
    return content;
  }

  private async pauseCompletionatorImport(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    session: ICompletionatorImport,
  ): Promise<void> {
    await setImportStatus(session.importId, "PAUSED");
    await this.cleanupCompletionatorThread(session.userId, session.importId);
    await this.sendCompletionatorPausedNotice(interaction, session.importId);
  }

  private async sendCompletionatorPausedNotice(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
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
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
      const threadChannel: ThreadChannel = channel as ThreadChannel;
      const baseEmbed: EmbedBuilder = new EmbedBuilder()
        .setTitle(`Completionator Import #${session.importId}`)
        .setDescription("Preparing import...");
      const wizardMessage: Message = await threadChannel.send({
        content: `<@${session.userId}>`,
        embeds: [baseEmbed],
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
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    const threadName: string = `Completionator Import #${session.importId}`;
    const thread: ThreadChannel = await parentMessage.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 60,
    });

    const baseEmbed: EmbedBuilder = new EmbedBuilder()
      .setTitle(`Completionator Import #${session.importId}`)
      .setDescription("Preparing import...");
    const wizardMessage: Message = await thread.send({
      content: `<@${session.userId}>`,
      embeds: [baseEmbed],
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
      const line = `${idxBlock} ${dateBlock} **${c.title}** (${typeAbbrev})`.replace(
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
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
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
    interaction: CommandInteraction | StringSelectMenuInteraction,
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
        await saveCompletion(
          sel,
          ctx.userId,
          imported.gameId,
          ctx.completionType,
          ctx.completedAt,
          ctx.finalPlaytimeHours,
          ctx.note,
          imported.title,
          ctx.announce,
        );
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

      await saveCompletion(
        interaction,
        ctx.userId,
        gameId,
        ctx.completionType,
        ctx.completedAt,
        ctx.finalPlaytimeHours,
        ctx.note,
        gameTitle ?? undefined,
        ctx.announce,
      );
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
