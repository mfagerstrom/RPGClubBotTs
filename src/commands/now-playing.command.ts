import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type User,
  AttachmentBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
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
  ModalComponent,
} from "discordx";
import {
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import { SeparatorSpacingSize } from "discord-api-types/v10";
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
const NOW_PLAYING_SEARCH_LIMIT = 10;
const NOW_PLAYING_SORT_MODAL_ID = "nowplaying-sort-modal";
const NOW_PLAYING_SORT_INPUT_PREFIX = "nowplaying-sort-input";
const NOW_PLAYING_SORT_CHUNK_SIZE = 5;
const NOW_PLAYING_NOTE_MODAL_ID = "nowplaying-note-modal";
const NOW_PLAYING_NOTE_INPUT_ID = "nowplaying-note-input";
const COMPONENTS_V2_FLAG = 1 << 15;
const NOW_PLAYING_GALLERY_MAX = 10;
type NowPlayingSortEntry = {
  gameId: number;
  title: string;
  sortOrder: number | null;
};

const nowPlayingSortSessions = new Map<string, {
  entries: NowPlayingSortEntry[];
  orders: Map<number, number>;
}>();
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

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  if (entry.threadId && guildId) {
    return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
  }
  return entry.title;
}

function sortNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  return [...entries].sort((a, b) => {
    const titleA = a.title.toLowerCase();
    const titleB = b.title.toLowerCase();
    const titleCompare = titleA.localeCompare(titleB);
    if (titleCompare !== 0) return titleCompare;
    const gameIdA = a.gameId ?? 0;
    const gameIdB = b.gameId ?? 0;
    return gameIdA - gameIdB;
  });
}

function getDisplayNowPlayingEntries(
  entries: IMemberNowPlayingEntry[],
): IMemberNowPlayingEntry[] {
  const hasManualOrder = entries.some((entry) => entry.sortOrder != null);
  return hasManualOrder ? entries : sortNowPlayingEntries(entries);
}

function buildSortModal(
  userId: string,
  entries: NowPlayingSortEntry[],
  chunkIndex: number,
): ModalBuilder {
  const start = chunkIndex * NOW_PLAYING_SORT_CHUNK_SIZE;
  const chunk = entries.slice(start, start + NOW_PLAYING_SORT_CHUNK_SIZE);
  const modal = new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_SORT_MODAL_ID}:${userId}:${chunkIndex}`)
    .setTitle("Sort Now Playing");

  chunk.forEach((entry, idx) => {
    const currentOrder = start + idx + 1;
    const input = new TextInputBuilder()
      .setCustomId(`${NOW_PLAYING_SORT_INPUT_PREFIX}:${entry.gameId}`)
      .setLabel(entry.title.slice(0, 45))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setValue(String(currentOrder));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  });

  return modal;
}

function buildSortContinueRow(userId: string, chunkIndex: number): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(`nowplaying-sort-open:${userId}:${chunkIndex}`)
    .setLabel("Open Sort Form")
    .setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

function buildSortValidationError(entryCount: number): string {
  return `Please provide each number 1-${entryCount} exactly once.`;
}

function toSortEntries(
  entries: Array<{ gameId: number; title: string; sortOrder: number | null }>,
): NowPlayingSortEntry[] {
  return entries.map((entry) => ({
    gameId: entry.gameId,
    title: entry.title,
    sortOrder: entry.sortOrder ?? null,
  }));
}

function buildEditNoteModal(
  ownerId: string,
  gameId: number,
  title: string,
  currentNote: string | null,
): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(NOW_PLAYING_NOTE_INPUT_ID)
    .setLabel(title.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN)
    .setValue(currentNote ?? "");

  return new ModalBuilder()
    .setCustomId(`${NOW_PLAYING_NOTE_MODAL_ID}:${ownerId}:${gameId}`)
    .setTitle("Edit Now Playing Note")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
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

  @Slash({ description: "Search for who is playing a GameDB title", name: "search" })
  async searchNowPlaying(
    @SlashOption({
      description: "Game title to search in GameDB",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const query = title.trim();
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (!query) {
      await safeReply(interaction, {
        content: "Please provide a title to search.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nowPlayingRows = await Member.getNowPlayingByTitleSearch(query);
    if (!nowPlayingRows.length) {
      await safeReply(interaction, {
        content: `No one is currently playing GameDB titles matching "${query}".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const usersByGameId = new Map<number, { title: string; users: string[] }>();
    for (const row of nowPlayingRows) {
      const record = usersByGameId.get(row.gameId) ?? { title: row.title, users: [] };
      record.users.push(`<@${row.userId}>`);
      usersByGameId.set(row.gameId, record);
    }

    const sortedGames = Array.from(usersByGameId.entries())
      .map(([gameId, record]) => ({ gameId, title: record.title, users: record.users }))
      .sort((a, b) => a.title.localeCompare(b.title));
    const totalGames = sortedGames.length;
    const limitedGames = sortedGames.slice(0, NOW_PLAYING_SEARCH_LIMIT);

    const embed = new EmbedBuilder()
      .setTitle("Now Playing Search")
      .setDescription(`Results for **${query}**.`);

    for (const game of limitedGames) {
      const uniqueUsers = Array.from(new Set(game.users));
      const displayedUsers = uniqueUsers.slice(0, 30);
      const remaining = uniqueUsers.length - displayedUsers.length;
      const userList = `${displayedUsers.join(", ")}${remaining > 0 ? ` (+${remaining} more)` : ""}`;
      embed.addFields({
        name: `${game.title} (GameDB #${game.gameId})`,
        value: userList,
      });
    }

    if (totalGames > limitedGames.length) {
      embed.setFooter({
        text: `Showing first ${limitedGames.length} of ${totalGames} titles with active players.`,
      });
    }

    await safeReply(interaction, {
      embeds: [embed],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
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

  @Slash({ description: "Sort your Now Playing list", name: "sort" })
  async sortNowPlaying(interaction: CommandInteraction): Promise<void> {
    const entries = toSortEntries(await Member.getNowPlayingEntries(interaction.user.id));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    nowPlayingSortSessions.set(interaction.user.id, {
      entries,
      orders: new Map(),
    });

    await interaction.showModal(buildSortModal(interaction.user.id, entries, 0)).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the sort form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
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

    const entriesWithNotes = current.filter((entry) => Boolean(entry.note?.trim()));
    if (!entriesWithNotes.length) {
      await safeReply(interaction, {
        content: "None of your Now Playing entries have notes to delete.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const options = entriesWithNotes.map((entry) => ({
      label: entry.title.slice(0, 100),
      value: String(entry.gameId),
      description: entry.note ? entry.note.slice(0, 95) : "Note",
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
      completedAt = parseCompletionDateInput(completionDate ?? "today");
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
        null,
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

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(
      buildEditNoteModal(ownerId, gameId, currentEntry.title, currentEntry.note ?? null),
    ).catch(async () => {
      await safeReply(interaction, {
        content: "Unable to open the note form right now.",
        flags: MessageFlags.Ephemeral,
      });
    });
  }

  @ButtonComponent({ id: /^nowplaying-sort-open:\d+:\d+$/ })
  async handleSortOpen(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, chunkRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This sort prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const chunkIndex = Number(chunkRaw);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      await safeReply(interaction, {
        content: "Invalid sort chunk.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = nowPlayingSortSessions.get(ownerId);
    const entries = session?.entries ?? toSortEntries(await Member.getNowPlayingEntries(ownerId));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!session) {
      nowPlayingSortSessions.set(ownerId, { entries, orders: new Map() });
    }

    await interaction.showModal(buildSortModal(ownerId, entries, chunkIndex)).catch(() => {});
  }

  @ModalComponent({ id: /^nowplaying-sort-modal:\d+:\d+$/ })
  async handleSortModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const [, ownerId, chunkRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This sort prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const chunkIndex = Number(chunkRaw);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      await safeReply(interaction, {
        content: "Invalid sort chunk.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = nowPlayingSortSessions.get(ownerId);
    const entries = session?.entries ?? toSortEntries(await Member.getNowPlayingEntries(ownerId));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "Your Now Playing list is empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const effectiveSession = session ?? {
      entries,
      orders: new Map<number, number>(),
    };
    nowPlayingSortSessions.set(ownerId, effectiveSession);

    const start = chunkIndex * NOW_PLAYING_SORT_CHUNK_SIZE;
    const chunk = entries.slice(start, start + NOW_PLAYING_SORT_CHUNK_SIZE);
    if (!chunk.length) {
      await safeReply(interaction, {
        content: "This sort chunk is no longer available.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    for (const entry of chunk) {
      effectiveSession.orders.delete(entry.gameId);
    }

    const used = new Set<number>(effectiveSession.orders.values());
    for (const entry of chunk) {
      const value = interaction.fields.getTextInputValue(
        `${NOW_PLAYING_SORT_INPUT_PREFIX}:${entry.gameId}`,
      );
      const order = Number(value);
      if (!Number.isInteger(order) || order < 1 || order > entries.length || used.has(order)) {
        await safeReply(interaction, {
          content: buildSortValidationError(entries.length),
          components: [buildSortContinueRow(ownerId, chunkIndex)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      used.add(order);
      effectiveSession.orders.set(entry.gameId, order);
    }

    const totalChunks = Math.ceil(entries.length / NOW_PLAYING_SORT_CHUNK_SIZE);
    const nextChunk = chunkIndex + 1;
    if (nextChunk < totalChunks) {
      await safeReply(interaction, {
        content: `Saved part ${chunkIndex + 1} of ${totalChunks}.`,
        components: [buildSortContinueRow(ownerId, nextChunk)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const orders = Array.from(effectiveSession.orders.values());
    const uniqueOrders = new Set(orders);
    const hasAll = orders.length === entries.length && uniqueOrders.size === entries.length;
    const inRange = orders.every((order) => order >= 1 && order <= entries.length);
    if (!hasAll || !inRange) {
      await safeReply(interaction, {
        content: buildSortValidationError(entries.length),
        components: [buildSortContinueRow(ownerId, 0)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const orderedIds = [...entries]
      .sort((a, b) => (effectiveSession.orders.get(a.gameId) ?? 0)
        - (effectiveSession.orders.get(b.gameId) ?? 0))
      .map((entry) => entry.gameId);

    const updated = await Member.updateNowPlayingSort(ownerId, orderedIds);
    nowPlayingSortSessions.delete(ownerId);
    await safeReply(interaction, {
      content: updated ? "Your Now Playing order has been updated." : "No changes made.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({ id: /^nowplaying-note-modal:\d+:\d+$/ })
  async handleEditNoteModal(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const [, ownerId, gameIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await safeReply(interaction, {
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const noteInput = interaction.fields.getTextInputValue(NOW_PLAYING_NOTE_INPUT_ID);
    const note = noteInput.trim();
    const nextNote = note ? note : null;
    if (note && note.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await safeReply(interaction, {
        content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, nextNote);
    await safeReply(interaction, {
      content: updated ? "Note updated." : "Could not update that entry.",
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

    const currentEntries = await Member.getNowPlayingEntries(ownerId);
    const currentEntry = currentEntries.find((entry) => entry.gameId === gameId);
    const currentNote = currentEntry?.note ? currentEntry.note : "No note set.";
    if (!currentEntry) {
      await safeReply(interaction, {
        content: "Entry not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Delete Note: ${currentEntry.title}`)
      .setDescription(currentEntry.note ? `> ${currentNote}` : "No note set.");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:yes`)
        .setLabel("Delete Note")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`nowplaying-delete-note-confirm:${ownerId}:${gameId}:no`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.update({
      content: "Confirm note deletion:",
      embeds: [embed],
      components: [row],
    });
  }

  @ButtonComponent({ id: /^nowplaying-delete-note-confirm:\d+:\d+:(yes|no)$/ })
  async handleDeleteNoteConfirm(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, gameIdRaw, choice] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This note prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (choice === "no") {
      await interaction.update({
        content: "Cancelled.",
        components: [],
      }).catch(() => {});
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

    const updated = await Member.updateNowPlayingNote(ownerId, gameId, null);
    await interaction.update({
      content: updated ? "Note deleted." : "Could not update that entry.",
      components: [],
    }).catch(() => {});
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
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing",
        `No Now Playing entries found for <@${target.id}>.`,
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const displayName = target.displayName ?? target.username ?? "User";
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      sortedEntries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const containers = this.buildNowPlayingEntryContainers(
      `${displayName}'s Now Playing List`,
      sortedEntries,
      interaction.guildId,
      thumbnailsByGameId,
    );
    await safeReply(interaction, {
      components: containers,
      files,
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  @SelectMenuComponent({ id: "nowplaying-all-select" })
  async handleNowPlayingAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const selectedUserId = interaction.values?.[0];
    if (!selectedUserId) return;

    const entries = await Member.getNowPlaying(selectedUserId);
    const target =
      (await interaction.client.users.fetch(selectedUserId).catch(() => null)) ??
      interaction.user;
    const lists = await Member.getAllNowPlaying();
    const selectRow = lists.length
      ? this.buildNowPlayingMemberSelect(lists, selectedUserId)
      : null;

    if (!entries.length) {
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        `No Now Playing entries found for <@${selectedUserId}>.`,
      );
      const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
      await interaction.update({
        components: [container, ...(selectRow ? [selectRow] : [])],
        flags: buildComponentsV2Flags(isEphemeral),
      });
      return;
    }

    const sortedEntries = getDisplayNowPlayingEntries(entries);
    const displayName = target.displayName ?? target.username ?? "User";
    const { files, thumbnailsByGameId } = await this.buildNowPlayingAttachments(
      sortedEntries,
      NOW_PLAYING_GALLERY_MAX,
    );
    const containers = this.buildNowPlayingEntryContainers(
      `${displayName}'s Now Playing List`,
      sortedEntries,
      interaction.guildId,
      thumbnailsByGameId,
    );
    const isEphemeral = interaction.message.flags?.has(MessageFlags.Ephemeral) ?? false;
    await interaction.update({
      components: [...containers, ...(selectRow ? [selectRow] : [])],
      files,
      flags: buildComponentsV2Flags(isEphemeral),
    });
  }

  private async showEveryone(
    interaction: CommandInteraction,
    ephemeral: boolean,
  ): Promise<void> {
    const lists = await Member.getAllNowPlaying();
    if (!lists.length) {
      const container = this.buildNowPlayingMessageContainer(
        "Now Playing - Everyone",
        "No Now Playing data found for anyone yet.",
      );
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(ephemeral),
      });
      return;
    }

    const sortedLists = [...lists].sort((a, b) => {
      const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const lines = sortedLists.map((record) => {
      const displayName = record.globalName ?? record.username ?? record.userId;
      const count = record.entries.length;
      const suffix = count === 1 ? "game" : "games";
      return `**${displayName}**: ${count} ${suffix}`;
    });

    const container = this.buildNowPlayingListContainer("Now Playing - Everyone", lines);

    const selectRow = this.buildNowPlayingMemberSelect(sortedLists);

    await safeReply(interaction, {
      components: [container, selectRow],
      flags: buildComponentsV2Flags(ephemeral),
    });
  }

  private buildNowPlayingListLines(
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
  ): string[] {
    const lines: string[] = [];
    entries.forEach((entry) => {
      lines.push(`- ${formatEntry(entry, guildId)}`);
      if (entry.note) {
        lines.push(`  - ${entry.note}`);
      }
    });
    return lines;
  }

  private buildNowPlayingListContainer(title: string, lines: string[]): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    if (lines.length) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }
    return container;
  }

  private buildNowPlayingMessageContainer(title: string, message: string): ContainerBuilder {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
    return container;
  }

  private async buildNowPlayingAttachments(
    entries: IMemberNowPlayingEntry[],
    maxImages: number = Number.POSITIVE_INFINITY,
  ): Promise<{ files: AttachmentBuilder[]; thumbnailsByGameId: Map<number, string> }> {
    const files: AttachmentBuilder[] = [];
    const seen = new Set<number>();
    const thumbnailsByGameId = new Map<number, string>();
    let imageCount = 0;
    for (const entry of entries) {
      if (!entry.gameId || seen.has(entry.gameId)) continue;
      seen.add(entry.gameId);
      const game = await Game.getGameById(entry.gameId);
      if (game?.imageData) {
        if (imageCount >= maxImages) {
          break;
        }
        const filename = `now_playing_${entry.gameId}.png`;
        files.push(
          new AttachmentBuilder(game.imageData, { name: filename }),
        );
        thumbnailsByGameId.set(entry.gameId, `attachment://${filename}`);
        imageCount += 1;
      }
    }
    return { files, thumbnailsByGameId };
  }

  private buildNowPlayingEntryContainers(
    title: string,
    entries: IMemberNowPlayingEntry[],
    guildId: string | null,
    thumbnailsByGameId: Map<number, string>,
  ): ContainerBuilder[] {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));

    const galleryItems: MediaGalleryItemBuilder[] = [];
    for (const entry of entries) {
      if (galleryItems.length >= NOW_PLAYING_GALLERY_MAX) {
        break;
      }
      if (!entry.gameId) {
        continue;
      }
      const imageUrl = thumbnailsByGameId.get(entry.gameId);
      if (!imageUrl) {
        continue;
      }
      const item = new MediaGalleryItemBuilder()
        .setURL(imageUrl)
        .setDescription(entry.title);
      galleryItems.push(item);
    }

    if (galleryItems.length) {
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(galleryItems));
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      );
    }
    const gameBlocks = entries.map((entry) => {
      const entryTitle = formatEntry(entry, guildId);
      if (!entry.note) {
        return `- **${entryTitle}**`;
      }
      return `- **${entryTitle}**\n  - ${entry.note}`;
    });
    if (gameBlocks.length) {
      const content = this.trimTextDisplayContent(gameBlocks.join("\n"));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
    return [container];
  }

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
  }


  private buildNowPlayingMemberSelect(
    lists: Array<{
      userId: string;
      username: string | null;
      globalName: string | null;
      entries: Array<unknown>;
    }>,
    selectedUserId?: string,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const sorted = [...lists].sort((a, b) => {
      const nameA = (a.globalName ?? a.username ?? a.userId).toLowerCase();
      const nameB = (b.globalName ?? b.username ?? b.userId).toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const options = sorted.slice(0, 25).map((record) => {
      const displayName = record.globalName ?? record.username ?? record.userId;
      return {
        label: displayName.slice(0, 100),
        value: record.userId,
        description: `${record.entries.length} ${record.entries.length === 1 ? "game" : "games"}`,
        default: record.userId === selectedUserId,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId("nowplaying-all-select")
      .setPlaceholder("View a member's Now Playing list")
      .addOptions(options);

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
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
