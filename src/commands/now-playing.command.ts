import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type User,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  type ActionRow,
  type MessageActionRowComponent,
  type Message,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashOption,
  SlashGroup,
  SlashChoice,
  SelectMenuComponent,
  ButtonComponent,
} from "discordx";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "../commands/profile.command.js";

const MAX_NOW_PLAYING = 10;
const MAX_NOW_PLAYING_NOTE_LEN = 500;
const nowPlayingAddSessions = new Map<
  string,
  { userId: string; query: string; note: string | null }
>();

type NowPlayingCompleteContext = {
  userId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  announce?: boolean;
};

const nowPlayingCompleteSessions = new Map<string, NowPlayingCompleteContext>();

function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  if (entry.threadId && guildId) {
    return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
  }
  return entry.title;
}

function chunkLines(lines: string[], maxLength: number = 3800): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current.length ? `${current}\n${line}` : line;
    if (next.length > maxLength && current.length > 0) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = next;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

async function promptForNote(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  question: string,
  timeoutMs: number = 120_000,
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.awaitMessages !== "function") {
    await safeReply(interaction, {
      content: "Cannot prompt for additional input; use this command in a text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  await safeReply(interaction, {
    content: `<@${userId}> ${question}`,
    flags: MessageFlags.Ephemeral,
  });

  try {
    const collected = await channel.awaitMessages({
      filter: (m: any) => m.author?.id === userId,
      max: 1,
      time: timeoutMs,
    });

    const first = collected?.first?.();
    if (!first) {
      await safeReply(interaction, {
        content: "Timed out waiting for a response.",
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    const content: string = (first.content ?? "").trim();
    await first.delete().catch(() => {});

    if (!content) {
      await safeReply(interaction, {
        content: "Empty response received. Cancelled.",
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    if (/^cancel$/i.test(content)) {
      await safeReply(interaction, {
        content: "Cancelled.",
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    if (content.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await safeReply(interaction, {
        content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    return content;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `Error while waiting for a response: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }
}

@Discord()
@SlashGroup({ description: "Show now playing data", name: "now-playing" })
@SlashGroup("now-playing")
export class NowPlayingCommand {
  @Slash({ description: "Show now playing data", name: "list" })
  async nowPlaying(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show everyone with Now Playing entries.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const showAllFlag = showAll === true;
    const target = member ?? interaction.user;
    const ephemeral = !(showAllFlag || showInChat);
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (showAllFlag) {
      await this.showEveryone(interaction, ephemeral);
      return;
    }

    await this.showSingle(interaction, target, ephemeral);
  }

  @Slash({ description: "Add a game to your Now Playing list", name: "add" })
  async addNowPlaying(
    @SlashOption({
      description: "Search text to find the game in GameDB",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    query: string,
    @SlashOption({
      description: "Optional note for this entry",
      name: "note",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    note: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    try {
      const results = await Game.searchGames(query);
      const trimmedNote = note?.trim();
      if (trimmedNote && trimmedNote.length > MAX_NOW_PLAYING_NOTE_LEN) {
        await safeReply(interaction, {
          content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const sessionId = `np-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      nowPlayingAddSessions.set(sessionId, {
        userId: interaction.user.id,
        query,
        note: trimmedNote ? trimmedNote : null,
      });

      const options = results.slice(0, 23).map((g) => ({
        label: g.title.substring(0, 100),
        value: String(g.id),
        description: `GameDB #${g.id}`,
      }));

      options.push({
        label: "Import another game from IGDB",
        value: "import-igdb",
        description: "Search IGDB and import a new GameDB entry",
      });

      const selectId = `nowplaying-add-select:${sessionId}`;
      const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(selectId)
          .setPlaceholder("Select the game to add")
          .addOptions(options),
      );

      await safeReply(interaction, {
        content: "Select the game to add to your Now Playing list:",
        components: [selectRow],
        flags: MessageFlags.Ephemeral,
      });

      setTimeout(async () => {
        try {
          const reply = (await interaction.fetchReply()) as Message<boolean>;
          const hasActiveComponents = reply.components.some((row) => {
            if (!("components" in row)) return false;
            const actionRow = row as ActionRow<MessageActionRowComponent>;
            return actionRow.components.length > 0;
          });
          if (!hasActiveComponents) return;

          await interaction.editReply({
            content: "Timed out waiting for a selection. No changes made.",
            components: [],
          });
        } catch {
          // ignore
        }
      }, 60_000);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not add to Now Playing: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
  async handleAddNowPlayingSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const session = nowPlayingAddSessions.get(sessionId);
    const ownerId = session?.userId;

    if (!session || interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This add prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const choice = interaction.values[0];
    if (choice === "import-igdb") {
      await this.startNowPlayingIgdbImport(interaction, session);
      return;
    }
    if (choice === "no-results") {
      await interaction.update({
        content: "No GameDB results. Please try a different search or import from IGDB.",
        components: [],
      });
      return;
    }

    const gameId = Number(choice);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.update({
        content: "Invalid selection. Please try again.",
        components: [],
      });
      return;
    }

    try {
      const game = await Game.getGameById(gameId);
      if (!game) {
        await interaction.update({
          content: "Selected game not found. Please try again.",
          components: [],
        });
        return;
      }

      await Member.addNowPlaying(ownerId, gameId, session.note);
      const list = await Member.getNowPlaying(ownerId);
      await interaction.update({
        content: `Added **${game.title}** to your Now Playing list (${list.length}/${MAX_NOW_PLAYING}).`,
        components: [],
      });
      nowPlayingAddSessions.delete(sessionId);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await interaction.update({
        content: `Could not add to Now Playing: ${msg}`,
        components: [],
      });
    }
  }

  @Slash({ description: "Remove a game from your Now Playing list", name: "remove" })
  async removeNowPlaying(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    try {
      const current = await Member.getNowPlayingEntries(interaction.user.id);
      if (!current.length) {
        await safeReply(interaction, {
          content: "Your Now Playing list is empty.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const emojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
      const lines = current.slice(0, emojis.length).map((entry, idx) => `${emojis[idx]} ${entry.title} (GameDB #${entry.gameId})`);

      const buttons = current.slice(0, emojis.length).map((entry, idx) =>
        new ButtonBuilder()
          .setCustomId(`np-remove:${interaction.user.id}:${entry.gameId}`)
          .setLabel(`${idx+1}`)
          .setStyle(ButtonStyle.Primary),
      );

      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
      }

      await safeReply(interaction, {
        content: "Select a game to remove from your Now Playing list:",
        embeds: [
          new EmbedBuilder()
            .setTitle("Now Playing")
            .setDescription(lines.join("\n")),
        ],
        components: rows,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not remove from Now Playing: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Add or update a note for a Now Playing entry",
    name: "edit-note",
  })
  async editNowPlayingNote(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const current = await Member.getNowPlayingEntries(interaction.user.id);
    if (!current.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const options = current.map((entry) => ({
      label: entry.title.slice(0, 100),
      value: String(entry.gameId),
      description: entry.note ? entry.note.slice(0, 95) : "Add a note",
    }));

    const selectId = `nowplaying-edit-note-select:${interaction.user.id}`;
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder("Select a game to edit its note")
        .addOptions(options),
    );

    await safeReply(interaction, {
      content: "Select a game to add or update its note:",
      components: [selectRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    description: "Delete a note from a Now Playing entry",
    name: "delete-note",
  })
  async deleteNowPlayingNote(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const current = await Member.getNowPlayingEntries(interaction.user.id);
    if (!current.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const options = current.map((entry) => ({
      label: entry.title.slice(0, 100),
      value: String(entry.gameId),
      description: entry.note ? entry.note.slice(0, 95) : "No note to delete",
    }));

    const selectId = `nowplaying-delete-note-select:${interaction.user.id}`;
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder("Select a game to delete its note")
        .addOptions(options),
    );

    await safeReply(interaction, {
      content: "Select a game to delete its note:",
      components: [selectRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Log completion for a game in your Now Playing list", name: "complete-game" })
  async completeGame(
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

    const userId = interaction.user.id;
    const list = await Member.getNowPlayingEntries(userId);

    if (!list.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty. Add a game first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sessionId = `np-comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    nowPlayingCompleteSessions.set(sessionId, {
      userId,
      completionType,
      completedAt,
      finalPlaytimeHours: finalPlaytimeHours ?? null,
      announce,
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`np-complete-select:${sessionId}`)
      .setPlaceholder("Select the game you completed")
      .addOptions(
        list.slice(0, 25).map((entry) => ({
          label: entry.title.slice(0, 100),
          value: String(entry.gameId),
          description: `GameDB #${entry.gameId}`,
        })),
      );

    await safeReply(interaction, {
      content: "Choose the game from your Now Playing list to mark as completed:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^np-complete-select:.+$/ })
  async handleCompleteGameSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId] = interaction.customId.split(":");
    const ctx = nowPlayingCompleteSessions.get(sessionId);

    if (!ctx) {
      await interaction.reply({
        content: "This completion prompt has expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== ctx.userId) {
      await interaction.reply({
        content: "This prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const value = interaction.values?.[0];
    const gameId = Number(value);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate();
      }
      
      const game = await Game.getGameById(gameId);
      await saveCompletion(
        interaction,
        ctx.userId,
        gameId,
        ctx.completionType,
        ctx.completedAt,
        ctx.finalPlaytimeHours,
        game?.title,
        ctx.announce,
      );

      await interaction.editReply({ components: [] });
    } finally {
      nowPlayingCompleteSessions.delete(sessionId);
    }
  }

  @SelectMenuComponent({ id: /^nowplaying-edit-note-select:\d+$/ })
  async handleEditNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const note = await promptForNote(
      interaction,
      "Enter a note for this Now Playing entry (or type `cancel`).",
    );
    if (!note) return;

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, note);
    await safeReply(interaction, {
      content: updated ? "Note saved." : "Could not update that entry.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^nowplaying-delete-note-select:\d+$/ })
  async handleDeleteNoteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, ownerId] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    await safeReply(interaction, {
      content: updated ? "Note deleted." : "Could not update that entry.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
  async handleRemoveNowPlayingButton(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This remove prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const removed = await Member.removeNowPlaying(ownerId, gameId);
      if (!removed) {
        await interaction.reply({
          content: "Failed to remove that game (it may have been removed already).",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const list = await Member.getNowPlaying(ownerId);
      await interaction.reply({
        content: `Removed GameDB #${gameId} from your Now Playing list (${list.length}/${MAX_NOW_PLAYING}).`,
        flags: MessageFlags.Ephemeral,
      });

      try {
        await interaction.message.edit({ components: [] }).catch(() => {});
      } catch {
        // ignore
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await interaction.reply({
        content: `Could not remove from Now Playing: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async showSingle(
    interaction: CommandInteraction,
    target: User,
    ephemeral: boolean,
  ): Promise<void> {
    const entries = await Member.getNowPlaying(target.id);
    if (!entries.length) {
      await safeReply(interaction, {
        content: `No Now Playing entries found for <@${target.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    let hasLinks = false;
    let hasUnlinked = false;

    const lines: string[] = [];
    entries.forEach((entry, idx) => {
      if (entry.threadId) hasLinks = true;
      else hasUnlinked = true;
      lines.push(`${idx + 1}. ${formatEntry(entry, interaction.guildId)}`);
      if (entry.note) {
        lines.push(`> ${entry.note}`);
      }
    });

    const footerParts: string[] = [];
    if (hasLinks) {
      footerParts.push("Links on game titles lead to their respective discussion threads.");
    }
    if (hasUnlinked) {
      footerParts.push(
        "For unlinked games, feel free to add a new thread or link one to the game if it already exists.",
      );
    }

    const displayName = target.displayName ?? target.username ?? "User";
    const embed = new EmbedBuilder()
      .setTitle(`${displayName}'s Now Playing List`)
      .setDescription(lines.join("\n"))
      .setAuthor({
        name: displayName,
        iconURL: target.displayAvatarURL({ size: 64, forceStatic: false }),
      })
      .setFooter({ text: footerParts.join("\n") });

    await safeReply(interaction, {
      embeds: [embed],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async showEveryone(
    interaction: CommandInteraction,
    ephemeral: boolean,
  ): Promise<void> {
    const lists = await Member.getAllNowPlaying();
    if (!lists.length) {
      await safeReply(interaction, {
        content: "No Now Playing data found for anyone yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    let hasLinks = false;
    let hasUnlinked = false;

    const lines = lists.map((record, idx) => {
      const displayName =
        record.globalName ?? record.username ?? `Member ${idx + 1}`;
      const gameLines: string[] = [];
      record.entries.forEach((entry) => {
        if (entry.threadId) hasLinks = true;
        else hasUnlinked = true;
        gameLines.push(formatEntry(entry, interaction.guildId));
        if (entry.note) {
          gameLines.push(`> ${entry.note}`);
        }
      });
      return `${idx + 1}. <@${record.userId}> (${displayName})\n${gameLines.join("\n")}`;
    });

    const footerParts: string[] = [];
    if (hasLinks) {
      footerParts.push("Links on game titles lead to their respective discussion threads.");
    }
    if (hasUnlinked) {
      footerParts.push(
        "For unlinked games, feel free to add a new thread or link one to the game if it already exists.",
      );
    }
    const footerText = footerParts.join("\n");

    const chunks = chunkLines(lines);
    const embeds = chunks.slice(0, 10).map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(idx === 0 ? "Now Playing - Everyone" : "Now Playing (continued)")
        .setDescription(chunk)
        .setFooter(footerText ? { text: footerText } : null),
    );

    const truncated = chunks.length > embeds.length;

    await safeReply(interaction, {
      content: truncated
        ? "Showing the first set of results (truncated to Discord embed limits)."
        : undefined,
      embeds,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async startNowPlayingIgdbImport(
    interaction: StringSelectMenuInteraction,
    session: { userId: string; query: string; note: string | null },
  ): Promise<void> {
    try {
      const searchRes = await igdbService.searchGames(session.query);
      if (!searchRes.results.length) {
        await interaction.update({
          content: `No IGDB results found for "${session.query}".`,
          components: [],
        });
        return;
      }

      const opts: IgdbSelectOption[] = searchRes.results.map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: (game.summary || "No summary").slice(0, 95),
        };
      });

      const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
        try {
          const imported = await this.importGameFromIgdb(igdbId);
          await Member.addNowPlaying(session.userId, imported.gameId, session.note);
          const list = await Member.getNowPlaying(session.userId);
          await sel.update({
            content: `Imported **${imported.title}** and added to Now Playing (${list.length}/${MAX_NOW_PLAYING}).`,
            components: [],
          });
        } catch (err: any) {
          const msg = err?.message ?? "Failed to import from IGDB.";
          await sel.reply({
            content: msg,
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      });

      await interaction.update({
        content: "Select an IGDB result to import and add to Now Playing:",
        components,
      });
    } catch (err: any) {
      const msg = err?.message ?? "Failed to search IGDB.";
      await interaction.update({
        content: msg,
        components: [],
      });
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
