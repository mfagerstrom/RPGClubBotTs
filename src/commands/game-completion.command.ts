import {
  ApplicationCommandOptionType,
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
  AttachmentBuilder,
  type User,
} from "discord.js";
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
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
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
  buildGameDbThumbAttachment,
  applyGameDbThumbnail,
} from "./profile.command.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";

type CompletionAddContext = {
  userId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  source: "existing" | "igdb";
  query?: string;
  announce?: boolean;
};

const completionAddSessions = new Map<string, CompletionAddContext>();

@Discord()
@SlashGroup({ description: "Manage game completions", name: "game-completion" })
@SlashGroup("game-completion")
export class GameCompletionCommands {
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
      description: "GameDB id (optional if using query/from_now_playing)",
      name: "game_id",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    gameId: number | undefined,
    @SlashOption({
      description: "Search text to find/import the game",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    @SlashOption({
      description: "Completion date (defaults to today)",
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
      description: "Filter to a specific year (optional)",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | undefined,
    @SlashOption({
      description: "Filter by title (optional)",
      name: "query",
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
      await this.renderCompletionLeaderboard(interaction, ephemeral);
      return;
    }

    const targetUserId = member ? member.id : interaction.user.id;
    await this.renderCompletionPage(interaction, targetUserId, 0, year ?? null, ephemeral, query);
  }

  @Slash({ description: "Edit one of your completion records", name: "edit" })
  async completionEdit(
    @SlashOption({
      description: "Filter by title (optional)",
      name: "query",
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
      name: "query",
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

    const headers = ["ID", "Game ID", "Title", "Type", "Completed Date", "Playtime (Hours)", "Created At"];
    const rows = completions.map((c) => {
      return [
        String(c.completionId),
        String(c.gameId),
        c.title,
        c.completionType,
        c.completedAt ? c.completedAt.toISOString().split("T")[0] : "",
        c.finalPlaytimeHours != null ? String(c.finalPlaytimeHours) : "",
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
    ];

    await interaction.reply({
      content: `Editing **${completion.title}** — choose a field to update:`,
      embeds: [
        new EmbedBuilder().setDescription(
          `Current: ${completion.completionType} — ${completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date"}${completion.finalPlaytimeHours != null ? ` — ${formatPlaytimeHours(completion.finalPlaytimeHours)}` : ""}`,
        ),
      ],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(fieldButtons)],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^comp-edit-field:[^:]+:\d+:(type|date|playtime)$/ })
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

      await interaction.reply({
        content: "Select the new completion type:",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const prompt =
      field === "date"
        ? "Type the new completion date (e.g., 2025-12-11)."
        : "Type the new final playtime in hours (e.g., 42.5).";

    await interaction.reply({
      content: prompt,
      flags: MessageFlags.Ephemeral,
    });

    const channel = interaction.channel;
    if (!channel || !("awaitMessages" in channel)) {
      await interaction.followUp({
        content: "I couldn't listen for your response in this channel.",
        flags: MessageFlags.Ephemeral,
      });
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
      await interaction.followUp({
        content: "Timed out waiting for your response.",
        flags: MessageFlags.Ephemeral,
      });
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
      }

      await interaction.followUp({
        content: "Completion updated.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      await interaction.followUp({
        content: err?.message ?? "Failed to update completion.",
        flags: MessageFlags.Ephemeral,
      });
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
      await interaction.reply({
        content: "Invalid completion type selected.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Member.updateCompletion(ownerId, completionId, { completionType: normalized });

    await interaction.reply({
      content: `Completion type updated to **${normalized}**.`,
      flags: MessageFlags.Ephemeral,
    });

    try {
      await interaction.message.edit({ components: [] }).catch(() => {});
    } catch {
      // ignore
    }
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
    const year = yearRaw ? Number(yearRaw) : null;
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
        Number.isNaN(year ?? NaN) ? null : year,
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
    const year = yearRaw ? Number(yearRaw) : null;
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
        Number.isNaN(year ?? NaN) ? null : year,
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
  ): Promise<void> {
    const leaderboard = await Member.getCompletionLeaderboard(25);
    if (!leaderboard.length) {
      await safeReply(interaction, {
        content: "No completions recorded yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const lines = leaderboard.map((m, idx) => {
      const name = m.globalName ?? m.username ?? m.userId;
      return `${idx + 1}. **${name}**: ${m.count} completions`;
    });

    const embed = new EmbedBuilder()
      .setTitle("Game Completion Leaderboard")
      .setDescription(lines.join("\n"));

    const options = leaderboard.map((m) => ({
      label: (m.globalName ?? m.username ?? m.userId).slice(0, 100),
      value: m.userId,
      description: `${m.count} completions`,
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId("comp-leaderboard-select")
      .setPlaceholder("View completions for a member")
      .addOptions(options);

    await safeReply(interaction, {
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @SelectMenuComponent({ id: "comp-leaderboard-select" })
  async handleCompletionLeaderboardSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const userId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.renderCompletionPage(interaction, userId, 0, null, true);
  }

  private createCompletionSession(ctx: CompletionAddContext): string {
    const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    completionAddSessions.set(sessionId, ctx);
    return sessionId;
  }

  private async buildCompletionEmbed(
    userId: string,
    page: number,
    year: number | null,
    interactionUser: User,
    query?: string,
  ): Promise<{
    embed: EmbedBuilder;
    attachment: AttachmentBuilder;
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
      const dateA = a.completedAt ? a.completedAt.getTime() : 0;
      const dateB = b.completedAt ? b.completedAt.getTime() : 0;
      const yearA = a.completedAt ? a.completedAt.getFullYear() : 0;
      const yearB = b.completedAt ? b.completedAt.getFullYear() : 0;

      if (yearA !== yearB) {
        return yearB - yearA;
      }
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
      const formattedDate = formatTableDate(c.completedAt);
      const dateLabel = formattedDate.padStart(dateWidth, " ");

      const typeAbbrev =
        c.completionType === "Main Story"
          ? "M"
          : c.completionType === "Main Story + Side Content"
            ? "M+S"
            : "C";

      const idxBlock = `\`${idxLabel}\``;
      const dateBlock = `\`${dateLabel}\``;
      const line = `${idxBlock} ${dateBlock} **${c.title}** (${typeAbbrev})`;
      acc[yr].push(line);
      return acc;
    }, {});

    const authorName = interactionUser.displayName ?? interactionUser.username ?? "User";
    const authorIcon = interactionUser.displayAvatarURL?.({
      size: 64,
      forceStatic: false,
    });
    const embed = new EmbedBuilder().setTitle(`${authorName}'s Completed Games (${total} total)`);

    embed.setAuthor({
      name: authorName,
      iconURL: authorIcon ?? undefined,
    });

    applyGameDbThumbnail(embed);

    const sortedYears = Object.keys(grouped).sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return Number(b) - Number(a);
    });

    const addChunkedField = (yr: string, content: string, chunkIndex: number): void => {
      let name = "";
      if (chunkIndex === 0) {
        const count = yearCounts[yr] ?? 0;
        name = `${yr} (${count})`;
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
      attachment: buildGameDbThumbAttachment(),
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
    year: number | null,
    ephemeral: boolean,
    query?: string,
  ): Promise<void> {
    const user =
      interaction.user.id === userId
        ? interaction.user
        : await interaction.client.users.fetch(userId).catch(() => interaction.user);

    const result = await this.buildCompletionEmbed(userId, page, year, user, query);

    if (!result) {
      await safeReply(interaction as any, {
        content: year
          ? `You have no recorded completions for ${year}.`
          : "You have no recorded completions yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const { embed, attachment, totalPages, safePage } = result;

    const yearPart = year ? String(year) : "";
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

      const prev = new ButtonBuilder()
        .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0);
      const next = new ButtonBuilder()
        .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:next${queryPart}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1);

      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
    }

    await safeReply(interaction as any, {
      embeds: [embed],
      files: [attachment],
      components,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async renderSelectionPage(
    interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    userId: string,
    page: number,
    mode: "edit" | "delete",
    year: number | null = null,
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

    const { embed, attachment, totalPages, safePage, pageCompletions } = result;

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

      const pageSelect = new StringSelectMenuBuilder()
        .setCustomId(`comp-page-select:${userId}:${year ?? ""}:${mode}${queryPart}`)
        .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
        .addOptions(options);

      components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pageSelect));

      const prev = new ButtonBuilder()
        .setCustomId(`comp-${mode}-page:${userId}:${year ?? ""}:${safePage}:prev${queryPart}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0);
      const next = new ButtonBuilder()
        .setCustomId(`comp-${mode}-page:${userId}:${year ?? ""}:${safePage}:next${queryPart}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages - 1);

      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
    }

    if (interaction.isMessageComponent()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], files: [attachment], components });
      } else {
        await interaction.update({ embeds: [embed], files: [attachment], components });
      }
    } else {
      await safeReply(interaction, {
        embeds: [embed],
        files: [attachment],
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

    const newGame = await Game.createGame(
      details.name,
      details.summary ?? "",
      null,
      details.id,
      details.slug ?? null,
      details.total_rating ?? null,
      details.url ?? null,
    );
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
