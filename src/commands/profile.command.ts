import {
  AttachmentBuilder,
  type CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  type User,
  MessageFlags,
  type Message,
  PermissionsBitField,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
} from "discord.js";
import { readFileSync } from "fs";
import path from "path";
import {
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
  ButtonComponent,
  SlashChoice,
} from "discordx";
import axios from "axios";
import Member, {
  type IMemberRecord,
  type IMemberSearchFilters,
} from "../classes/Member.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";


export const COMPLETION_TYPES = [
  "Main Story",
  "Main Story + Side Content",
  "Completionist",
] as const;

const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(
  process.cwd(),
  "src",
  "assets",
  "images",
  GAME_DB_THUMB_NAME,
);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);

export function buildGameDbThumbAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}

export function applyGameDbThumbnail(embed: EmbedBuilder): EmbedBuilder {
  return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}

export type CompletionType = (typeof COMPLETION_TYPES)[number];

type CompletionAddContext = {
  userId: string;
  completionType: CompletionType;
  completedAt: Date | null;
  finalPlaytimeHours: number | null;
  source: "existing" | "igdb";
};

const completionAddSessions = new Map<string, CompletionAddContext>();

export const COMPLETION_PAGE_SIZE = 20;

type ProfileField = {
  label: string;
  value: string;
  inline?: boolean;
};

export type ProfileViewPayload = {
  payload?: {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
  };
  notFoundMessage?: string;
  errorMessage?: string;
};

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function clampLimit(limit: number | undefined, max: number): number {
  if (!limit || Number.isNaN(limit)) return Math.min(50, max);
  return Math.min(Math.max(limit, 1), max);
}

export function parseCompletionDateInput(value: string | undefined): Date | null {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Could not parse completion date. Use a format like 2025-12-11.");
  }
  return parsed;
}

export function formatPlaytimeHours(val: number | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  const rounded = Math.round(val * 100) / 100;
  return `${rounded} hours`;
}

function formatCompletionLine(
  record: Awaited<ReturnType<typeof Member.getCompletions>>[number],
): string {
  const date = record.completedAt ? formatDiscordTimestamp(record.completedAt) : "Date not set";
  const playtime = formatPlaytimeHours(record.finalPlaytimeHours);
  const extras = [date, playtime].filter(Boolean).join(" — ");
  return `${record.title} — ${record.completionType}${extras ? ` — ${extras}` : ""}`;
}

export function formatTableDate(date: Date | null): string {
  if (!date) return "No date";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function summarizeFilters(filters: IMemberSearchFilters): string {
  const parts: string[] = [];
  if (filters.userId) parts.push(`userId~${filters.userId}`);
  if (filters.username) parts.push(`username~${filters.username}`);
  if (filters.globalName) parts.push(`globalName~${filters.globalName}`);
  if (filters.completionatorUrl) parts.push(`completionator~${filters.completionatorUrl}`);
  if (filters.steamUrl) parts.push(`steam~${filters.steamUrl}`);
  if (filters.psnUsername) parts.push(`psn~${filters.psnUsername}`);
  if (filters.xblUsername) parts.push(`xbl~${filters.xblUsername}`);
  if (filters.nswFriendCode) parts.push(`switch~${filters.nswFriendCode}`);
  if (filters.roleAdmin !== undefined) parts.push(`admin=${filters.roleAdmin ? 1 : 0}`);
  if (filters.roleModerator !== undefined)
    parts.push(`moderator=${filters.roleModerator ? 1 : 0}`);
  if (filters.roleRegular !== undefined) parts.push(`regular=${filters.roleRegular ? 1 : 0}`);
  if (filters.roleMember !== undefined) parts.push(`member=${filters.roleMember ? 1 : 0}`);
  if (filters.roleNewcomer !== undefined) parts.push(`newcomer=${filters.roleNewcomer ? 1 : 0}`);
  if (filters.isBot !== undefined) parts.push(`bot=${filters.isBot ? 1 : 0}`);
  if (filters.joinedAfter) parts.push(`joined>=${filters.joinedAfter.toISOString()}`);
  if (filters.joinedBefore) parts.push(`joined<=${filters.joinedBefore.toISOString()}`);
  if (filters.lastSeenAfter) parts.push(`seen>=${filters.lastSeenAfter.toISOString()}`);
  if (filters.lastSeenBefore) parts.push(`seen<=${filters.lastSeenBefore.toISOString()}`);
  parts.push(`includeDeparted=${filters.includeDeparted ? "yes" : "no"}`);
  return parts.join(" | ") || "none";
}

function chunkOptions<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function formatDiscordTimestamp(value: Date | null): string {
  if (!value) return "Unknown";
  const seconds = Math.floor(value.getTime() / 1000);
  return `<t:${seconds}:F>`;
}

function buildProfileFields(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
  nickHistory: string[],
  nowPlaying: { title: string; threadId: string | null }[],
  completions: Awaited<ReturnType<typeof Member.getCompletions>>,
  guildId?: string,
): ProfileField[] {
  if (!record) {
    return [];
  }

  const fields: ProfileField[] = [];

  const globalName = record.globalName ?? "Unknown";
  if (globalName !== "Unknown") {
    fields.push({ label: "Global Name", value: globalName, inline: true });
  }

  if (record.isBot) {
    fields.push({ label: "Bot", value: "Yes", inline: true });
  }

  if (nickHistory.length > 0) {
    fields.push({
      label: "AKA",
      value: nickHistory.join(", "),
      inline: true,
    });
  }

  fields.push({
    label: "Roles",
    value:
      [
        record.roleAdmin ? "Admin" : null,
        record.roleModerator ? "Moderator" : null,
        record.roleRegular ? "Regular" : null,
        record.roleMember ? "Member" : null,
        record.roleNewcomer ? "Newcomer" : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/, $/, "") || "None",
    inline: true,
  });

  fields.push({
    label: "Last Seen",
    value: formatDiscordTimestamp(record.lastSeenAt),
  });
  fields.push({
    label: "Joined Server",
    value: formatDiscordTimestamp(record.serverJoinedAt),
  });

  if (record.completionatorUrl) {
    fields.push({ label: "Game Collection Tracker URL", value: record.completionatorUrl });
  }

  if (record.steamUrl) {
    fields.push({ label: "Steam", value: record.steamUrl });
  }

  if (record.psnUsername) {
    fields.push({ label: "PSN", value: record.psnUsername, inline: true });
  }

  if (record.xblUsername) {
    fields.push({ label: "Xbox", value: record.xblUsername, inline: true });
  }

  if (record.nswFriendCode) {
    fields.push({ label: "Switch", value: record.nswFriendCode, inline: true });
  }

  if (nowPlaying.length) {
    const lines = nowPlaying.map((entry) => {
      if (entry.threadId && guildId) {
        return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
      }
      return entry.title;
    });
    fields.push({
      label: "Now Playing",
      value: lines.join("\n"),
    });
  }

  if (completions.length) {
    const lines = completions.map((c) => formatCompletionLine(c));
    fields.push({
      label: "Completed (recent)",
      value: lines.join("\n"),
    });
  }

  return fields;
}

function buildAvatarAttachment(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
): AttachmentBuilder | null {
  if (!record?.avatarBlob) return null;
  return new AttachmentBuilder(record.avatarBlob, { name: "profile-avatar.png" });
}

function avatarBuffersDifferent(a: Buffer | null, b: Buffer | null): boolean {
  if (!a && !b) return false;
  if (!!a !== !!b) return true;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  return !a.equals(b);
}

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function buildBaseMemberRecord(user: User): IMemberRecord {
  return {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: user.username ?? null,
    globalName: (user as any).globalName ?? null,
    avatarBlob: null,
    serverJoinedAt: null,
    serverLeftAt: null,
    lastSeenAt: null,
    roleAdmin: 0,
    roleModerator: 0,
    roleRegular: 0,
    roleMember: 0,
    roleNewcomer: 0,
    messageCount: null,
    completionatorUrl: null,
    psnUsername: null,
    xblUsername: null,
    nswFriendCode: null,
    steamUrl: null,
    profileImage: null,
    profileImageAt: null,
  };
}

export async function buildProfileViewPayload(
  target: User,
  guildId?: string,
): Promise<ProfileViewPayload> {
  try {
    let record = await Member.getByUserId(target.id);
    const nowPlaying = await Member.getNowPlaying(target.id);
    const completions = await Member.getCompletions({ userId: target.id, limit: 5 });
    const nickHistoryEntries = await Member.getRecentNickHistory(target.id, 6);
    const avatarUrl = target.displayAvatarURL({
      extension: "png",
      size: 512,
      forceStatic: true,
    });

    if (avatarUrl) {
      const newAvatar = await downloadAvatar(avatarUrl);
      const baseRecord: IMemberRecord = record ?? buildBaseMemberRecord(target);

      if (newAvatar && avatarBuffersDifferent(baseRecord.avatarBlob, newAvatar)) {
        record = {
          ...baseRecord,
          avatarBlob: newAvatar,
          username: target.username ?? baseRecord.username,
          globalName: (target as any).globalName ?? baseRecord.globalName,
          isBot: target.bot ? 1 : 0,
        };
        await Member.upsert(record);
      } else if (!record) {
        record = baseRecord;
      }
    }

    if (!record) {
      return { notFoundMessage: `No profile data found for <@${target.id}>.` };
    }

    const nickHistory: string[] = [];
    for (const entry of nickHistoryEntries) {
      const candidateRaw = entry.oldNick ?? entry.newNick;
      const candidate = candidateRaw?.trim();
      if (!candidate) continue;
      if (candidate === record.globalName || candidate === record.username) continue;
      if (nickHistory.includes(candidate)) continue;
      nickHistory.push(candidate);
      if (nickHistory.length >= 5) break;
    }

    const fields = buildProfileFields(record, nickHistory, nowPlaying, completions, guildId).map((f) => ({
      name: f.label,
      value: f.value,
      inline: f.inline ?? false,
    }));
    const embed = new EmbedBuilder()
      .setTitle("Member Profile")
      .setDescription(`<@${target.id}>`)
      .addFields(fields);

    const attachment = buildAvatarAttachment(record);
    if (attachment) {
      embed.setThumbnail("attachment://profile-avatar.png");
    } else if (target.displayAvatarURL()) {
      embed.setThumbnail(target.displayAvatarURL());
    }

    return {
      payload: {
        embeds: [embed],
        files: attachment ? [attachment] : undefined,
      },
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return { errorMessage: `Error loading profile: ${msg}` };
  }
}

@SlashGroup({ description: "Profile commands", name: "profile" })
@Discord()
export class ProfileCommand {
  @Slash({ description: "Show a member profile", name: "view" })
  @SlashGroup("profile")
  async profileView(
    @SlashOption({
      description: "Member to view; leave blank to view your own profile.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const result = await buildProfileViewPayload(target, interaction.guildId ?? undefined);

    if (result.errorMessage) {
      await safeReply(interaction, {
        content: result.errorMessage,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (!result.payload) {
      await safeReply(interaction, {
        content:
          result.notFoundMessage ?? `No profile data found for <@${target.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await safeReply(interaction, {
      ...result.payload,
      ephemeral,
    });
  }

  @Slash({ description: "Add a game completion", name: "completion-add" })
  @SlashGroup("profile")
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
      description: "Pick a game from your Now Playing list",
      name: "from_now_playing",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    fromNowPlaying: boolean | undefined,
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

    if (finalPlaytimeHours !== undefined && (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)) {
      await safeReply(interaction, {
        content: "Final playtime must be a non-negative number of hours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const playtime = finalPlaytimeHours === undefined ? null : finalPlaytimeHours;
    const userId = interaction.user.id;

    if (fromNowPlaying) {
      const list = await Member.getNowPlayingEntries(userId);
      if (!list.length) {
        await safeReply(interaction, {
          content: "Your Now Playing list is empty. Add a game first or use query/game_id.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const sessionId = this.createCompletionSession({
        userId,
        completionType,
        completedAt,
        finalPlaytimeHours: playtime,
        source: "existing",
      });
      const select = new StringSelectMenuBuilder()
        .setCustomId(`completion-add-select:${sessionId}`)
        .setPlaceholder("Select a game from Now Playing")
        .addOptions(
          list.slice(0, 25).map((entry) => ({
            label: entry.title.slice(0, 100),
            value: String(entry.gameId),
            description: `GameDB #${entry.gameId}`,
          })),
        );

      await safeReply(interaction, {
        content: "Choose the game you just completed:",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
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
      await this.saveCompletion(interaction, userId, game.id, completionType, completedAt, playtime, game.title);
      return;
    }

    const searchTerm = (query ?? "").trim();
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Provide a game_id, set from_now_playing:true, or include a search query.",
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
    });
  }

  @Slash({ description: "List your completed games", name: "completion-list" })
  @SlashGroup("profile")
  async completionList(
    @SlashOption({
      description: "Filter to a specific year (optional)",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | undefined,
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
    await this.renderCompletionPage(interaction, interaction.user.id, 0, year ?? null, ephemeral);
  }

  @Slash({ description: "Edit one of your completion records", name: "completion-edit" })
  @SlashGroup("profile")
  async completionEdit(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
    if (!completions.length) {
      await safeReply(interaction, {
        content: "You have no completions to edit.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const emojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
    const lines = completions.map(
      (c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`,
    );
    const buttons = completions.map((c, idx) =>
      new ButtonBuilder()
        .setCustomId(`comp-edit:${interaction.user.id}:${c.completionId}`)
        .setLabel(emojis[idx])
        .setStyle(ButtonStyle.Primary),
    );

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    }

    await safeReply(interaction, {
      content: "Select a completion to edit:",
      embeds: [
        new EmbedBuilder()
          .setTitle("Your Completions")
          .setDescription(lines.join("\n")),
      ],
      components: rows,
              flags: MessageFlags.Ephemeral,    });
  }

  @Slash({ description: "Delete one of your completion records", name: "completion-delete" })
  @SlashGroup("profile")
  async completionDelete(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
    if (!completions.length) {
      await safeReply(interaction, {
        content: "You have no completions to delete.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const emojis = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
    const lines = completions.map(
      (c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`,
    );
    const buttons = completions.map((c, idx) =>
      new ButtonBuilder()
        .setCustomId(`comp-del:${interaction.user.id}:${c.completionId}`)
        .setLabel(emojis[idx])
        .setStyle(ButtonStyle.Danger),
    );

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
    }

    await safeReply(interaction, {
      content: "Select a completion to delete:",
      embeds: [
        new EmbedBuilder()
          .setTitle("Your Completions")
          .setDescription(lines.join("\n")),
      ],
      components: rows,
              flags: MessageFlags.Ephemeral,    });
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

  @ButtonComponent({ id: /^comp-del:[^:]+:\d+$/ })
  async handleCompletionDeleteButton(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, completionIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This delete prompt isn't for you.",
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

  @ButtonComponent({ id: /^comp-edit:[^:]+:\d+$/ })
  async handleCompletionEditSelect(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, completionIdRaw] = interaction.customId.split(":");
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

    const completions = await Member.getCompletions({ userId: ownerId, limit: 25 });
    const completion = completions.find((c) => c.completionId === completionId);
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

    const prompt =
      field === "type"
        ? "Type the new completion type (Main Story | Main Story + Side Content | Completionist):"
        : field === "date"
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
      if (field === "type") {
        const normalized = COMPLETION_TYPES.find(
          (t) => t.toLowerCase() === value.toLowerCase(),
        );
        if (!normalized) {
          throw new Error("Invalid completion type.");
        }
        await Member.updateCompletion(ownerId, completionId, { completionType: normalized });
      } else if (field === "date") {
        const dt = parseCompletionDateInput(value);
        await Member.updateCompletion(ownerId, completionId, { completedAt: dt });
      } else if (field === "playtime") {
        const num = Number(value);
        if (Number.isNaN(num) || num < 0) throw new Error("Playtime must be a non-negative number.");
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

  @ButtonComponent({ id: /^comp-list-page:[^:]+:[^:]*:\d+:(prev|next)$/ })
  async handleCompletionListPaging(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, yearRaw, pageRaw, dir] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
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

    await this.renderCompletionPage(interaction, ownerId, nextPage, Number.isNaN(year ?? NaN) ? null : year, ephemeral);
  }









  @SelectMenuComponent({ id: /^profile-search-select-\d+$/ })
  async handleProfileSearchSelect(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const userId = interaction.values?.[0];
    if (!userId) {
      await safeReply(interaction, {
        content: "Could not determine which member to load.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const user = await interaction.client.users.fetch(userId);
      const result = await buildProfileViewPayload(user, interaction.guildId ?? undefined);

      if (result.errorMessage) {
        await safeReply(interaction, {
          content: result.errorMessage,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!result.payload) {
        await safeReply(interaction, {
          content:
            result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await safeReply(interaction, {
        ...result.payload,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not load that profile: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Search member profiles", name: "search" })
  @SlashGroup("profile")
  async profileSearch(
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    @SlashOption({
      description: "Filter by user id.",
      name: "userid",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    userId: string | undefined,
    @SlashOption({
      description: "Filter by username (contains).",
      name: "username",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    username: string | undefined,
    @SlashOption({
      description: "Filter by global display name (contains).",
      name: "globalname",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    globalName: string | undefined,
    @SlashOption({
      description: "Filter by Game Collection Tracker URL (contains).",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "Filter by Steam URL (contains).",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    @SlashOption({
      description: "Filter by PlayStation Network username (contains).",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Filter by Xbox Live username (contains).",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Filter by Nintendo Switch friend code (contains).",
      name: "switch",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Filter by Admin role flag (1 or 0).",
      name: "admin",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleAdmin: boolean | undefined,
    @SlashOption({
      description: "Filter by Moderator role flag (1 or 0).",
      name: "moderator",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleModerator: boolean | undefined,
    @SlashOption({
      description: "Filter by Regular role flag (1 or 0).",
      name: "regular",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleRegular: boolean | undefined,
    @SlashOption({
      description: "Filter by Member role flag (1 or 0).",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleMember: boolean | undefined,
    @SlashOption({
      description: "Filter by Newcomer role flag (1 or 0).",
      name: "newcomer",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    roleNewcomer: boolean | undefined,
    @SlashOption({
      description: "Filter by bot flag (1 or 0).",
      name: "bot",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    isBot: boolean | undefined,
    @SlashOption({
      description: "Joined server on/after (ISO date/time).",
      name: "joinedafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedAfter: string | undefined,
    @SlashOption({
      description: "Joined server on/before (ISO date/time).",
      name: "joinedbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joinedBefore: string | undefined,
    @SlashOption({
      description: "Last seen on/after (ISO date/time).",
      name: "lastseenafter",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenAfter: string | undefined,
    @SlashOption({
      description: "Last seen on/before (ISO date/time).",
      name: "lastseenbefore",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    lastSeenBefore: string | undefined,
    @SlashOption({
      description: "Max results to return (1-50).",
      name: "limit",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    limit: number | undefined,
    @SlashOption({
      description: "Include departed members (SERVER_LEFT_AT not null).",
      name: "include-departed-members",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    includeDeparted: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const joinedAfterDate = parseDateInput(joinedAfter);
    const joinedBeforeDate = parseDateInput(joinedBefore);
    const lastSeenAfterDate = parseDateInput(lastSeenAfter);
    const lastSeenBeforeDate = parseDateInput(lastSeenBefore);

    if (joinedAfter && !joinedAfterDate) {
      await safeReply(interaction, {
        content: "Invalid joinedafter date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (joinedBefore && !joinedBeforeDate) {
      await safeReply(interaction, {
        content: "Invalid joinedbefore date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (lastSeenAfter && !lastSeenAfterDate) {
      await safeReply(interaction, {
        content: "Invalid lastseenafter date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (lastSeenBefore && !lastSeenBeforeDate) {
      await safeReply(interaction, {
        content: "Invalid lastseenbefore date/time. Please use an ISO format.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const filters: IMemberSearchFilters = {
      userId,
      username,
      globalName,
      completionatorUrl: completionator,
      steamUrl: steam,
      psnUsername: psn,
      xblUsername: xbl,
      nswFriendCode: nsw,
      roleAdmin,
      roleModerator,
      roleRegular,
      roleMember,
      roleNewcomer,
      isBot,
      joinedAfter: joinedAfterDate ?? undefined,
      joinedBefore: joinedBeforeDate ?? undefined,
      lastSeenAfter: lastSeenAfterDate ?? undefined,
      lastSeenBefore: lastSeenBeforeDate ?? undefined,
      limit: clampLimit(limit, 100),
      includeDeparted: includeDeparted ?? false,
    };

    const results = await Member.search(filters);
    if (!results.length) {
      await safeReply(interaction, {
        content: "No members matched those filters.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const filterSummary = summarizeFilters(filters);
    const lines = results.map((record, idx) => {
      const name = record.globalName ?? record.username;
      const label = name ? `(${name})` : "";
      const botTag = record.isBot ? " [Bot]" : "";
      return `${idx + 1}. <@${record.userId}> ${label}${botTag}`;
    });

    const description = `Filters: ${filterSummary}\n\n${lines.join("\n")}`;

    const selectOptions = results.map((record, idx) => {
      const label = (record.globalName ?? record.username ?? `Member ${idx + 1}`).slice(0, 100);
      const descriptionText = `ID: ${record.userId}${record.isBot ? " | Bot" : ""}`;
      return {
        label,
        value: record.userId,
        description: descriptionText.slice(0, 100),
      };
    });

    const selectChunks = chunkOptions(selectOptions, 25);
    const components = selectChunks.slice(0, 5).map((chunk, idx) =>
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`profile-search-select-${idx}`)
          .setPlaceholder("Select a member to view their profile")
          .addOptions(chunk)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );

    const embed = new EmbedBuilder()
      .setTitle(`Profile search (${results.length})`)
      .setDescription(description.slice(0, 4000))
      .setFooter({ text: "Choose a member below to view a profile." });

    const content =
      selectChunks.length > 5
        ? "Showing the first 125 selectable results (Discord limits). Refine filters to narrow further."
        : description.length > 4000
            ? "Showing truncated results (Discord length limits). Refine filters for more detail."
            : undefined;

    await safeReply(interaction, {
      content,
      embeds: [embed],
      components,
      ephemeral,
    });
  }

  @Slash({ description: "Edit profile links (self, or any user if admin)", name: "edit" })
  @SlashGroup("profile")
  async profileEdit(
    @SlashOption({
      description: "Member to edit; admin only.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Game Collection Tracker URL.",
      name: "completionator",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    completionator: string | undefined,
    @SlashOption({
      description: "PlayStation Network username.",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    psn: string | undefined,
    @SlashOption({
      description: "Xbox Live username.",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    xbl: string | undefined,
    @SlashOption({
      description: "Nintendo Switch friend code.",
      name: "nsw",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    nsw: string | undefined,
    @SlashOption({
      description: "Steam profile URL.",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    steam: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const isAdmin =
      interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
    const isSelf = target.id === interaction.user.id;
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (!isSelf && !isAdmin) {
      await safeReply(interaction, {
        content: "You can only edit your own profile.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (
      completionator === undefined &&
      psn === undefined &&
      xbl === undefined &&
      nsw === undefined &&
      steam === undefined
    ) {
      await safeReply(interaction, {
        content: "Provide at least one field to update.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const existing = (await Member.getByUserId(target.id)) ?? buildBaseMemberRecord(target);

      const updated: IMemberRecord = {
        ...existing,
        username: existing.username ?? target.username ?? null,
        globalName: existing.globalName ?? (target as any).globalName ?? null,
        completionatorUrl:
          completionator !== undefined ? completionator || null : existing.completionatorUrl,
        psnUsername: psn !== undefined ? psn || null : existing.psnUsername,
        xblUsername: xbl !== undefined ? xbl || null : existing.xblUsername,
        nswFriendCode: nsw !== undefined ? nsw || null : existing.nswFriendCode,
        steamUrl: steam !== undefined ? steam || null : existing.steamUrl,
      };

      await Member.upsert(updated);

      const changedFields: string[] = [];
      if (completionator !== undefined) changedFields.push("Completionator");
      if (psn !== undefined) changedFields.push("PSN");
      if (xbl !== undefined) changedFields.push("Xbox");
      if (nsw !== undefined) changedFields.push("Switch");
      if (steam !== undefined) changedFields.push("Steam");

      await safeReply(interaction, {
        content: `Updated profile for <@${target.id}> (${changedFields.join(", ")}).`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating profile: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private createCompletionSession(ctx: CompletionAddContext): string {
    const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    completionAddSessions.set(sessionId, ctx);
    return sessionId;
  }

  private async renderCompletionPage(
    interaction: CommandInteraction | ButtonInteraction,
    userId: string,
    page: number,
    year: number | null,
    ephemeral: boolean,
  ): Promise<void> {
    const total = await Member.countCompletions(userId, year);
    if (total === 0) {
      await safeReply(interaction as any, {
        content: year ? `You have no recorded completions for ${year}.` : "You have no recorded completions yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * COMPLETION_PAGE_SIZE;

    const completions = await Member.getCompletions({
      userId,
      limit: COMPLETION_PAGE_SIZE,
      offset,
      year,
    });

    if (!completions.length) {
      if (safePage > 0) {
        await this.renderCompletionPage(interaction, userId, 0, year, ephemeral);
        return;
      }
      await safeReply(interaction as any, {
        content: "You have no recorded completions yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const maxIndexLabelLength = `${offset + completions.length}.`.length;
    const dateWidth = 10; // MM/DD/YYYY

    const counts: Record<string, number> = {};

    const grouped = completions.reduce<Record<string, string[]>>((acc, c) => {
      const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
      acc[yr] = acc[yr] || [];

      counts[yr] = (counts[yr] ?? 0) + 1;

      const idxLabelRaw = `${counts[yr]}.`;
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

    const authorName =
      (interaction as any).user?.displayName ??
      (interaction as any).user?.username ??
      "User";
    const authorIcon = (interaction as any).user?.displayAvatarURL?.({
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
      const name = chunkIndex === 0 ? yr : "";
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

    const yearPart = year ? String(year) : "";
    const prev = new ButtonBuilder()
      .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:prev`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0);
    const next = new ButtonBuilder()
      .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:next`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1);

    const components =
      totalPages > 1
        ? [new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next)]
        : [];

    const footerLines = [
      "M = Main Story • M+S = Main Story + Side Content • C = Completionist",
    ];
    if (totalPages > 1) {
      footerLines.push(`${total} results. Page ${safePage + 1} of ${totalPages}.`);
    }
    embed.setFooter({ text: footerLines.join("\n") });

    await safeReply(interaction as any, {
      embeds: [embed],
      files: [buildGameDbThumbAttachment()],
      components,
      ephemeral,
    });
  }

  private async promptCompletionSelection(
    interaction: CommandInteraction,
    searchTerm: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
    const localResults = await Game.searchGames(searchTerm);
    if (localResults.length) {
      const sessionId = this.createCompletionSession(ctx);
      const select = new StringSelectMenuBuilder()
        .setCustomId(`completion-add-select:${sessionId}`)
        .setPlaceholder("Select a game to log completion")
        .addOptions(
          localResults.slice(0, 25).map((game) => ({
            label: game.title.slice(0, 100),
            value: String(game.id),
            description: `GameDB #${game.id}`,
          })),
        );

      await safeReply(interaction, {
        content: `Select the game for "${searchTerm}".`,
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const igdbSearch = await igdbService.searchGames(searchTerm);
    if (!igdbSearch.results.length) {
      await safeReply(interaction, {
        content: `No GameDB or IGDB matches found for "${searchTerm}".`,
        flags: MessageFlags.Ephemeral,
      });
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
        const imported = await this.importGameFromIgdb(gameId);
        await this.saveCompletion(
          sel,
          ctx.userId,
          imported.gameId,
          ctx.completionType,
          ctx.completedAt,
          ctx.finalPlaytimeHours,
          imported.title,
        );
      },
    );

    await safeReply(interaction, {
      content: `No GameDB match; select an IGDB result to import for "${searchTerm}".`,
      components,
              flags: MessageFlags.Ephemeral,    });
  }

  private async processCompletionSelection(
    interaction: StringSelectMenuInteraction,
    value: string,
    ctx: CompletionAddContext,
  ): Promise<void> {
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
          return;
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
          return;
        }
        const game = await Game.getGameById(parsedId);
        if (!game) {
          await interaction.followUp({
            content: "Selected game was not found in GameDB.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        gameId = game.id;
        gameTitle = game.title;
      }

      if (!gameId) {
        await interaction.followUp({
          content: "Could not determine a game to log.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await this.saveCompletion(
        interaction,
        ctx.userId,
        gameId,
        ctx.completionType,
        ctx.completedAt,
        ctx.finalPlaytimeHours,
        gameTitle ?? undefined,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await interaction.followUp({
        content: `Failed to add completion: ${msg}`,
        flags: MessageFlags.Ephemeral,
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



  private async saveCompletion(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    userId: string,
    gameId: number,
    completionType: CompletionType,
    completedAt: Date | null,
    finalPlaytimeHours: number | null,
    gameTitle?: string,
  ): Promise<void> {
    if (interaction.user.id !== userId) {
      await interaction.followUp({
        content: "You can only log completions for yourself.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.followUp({
        content: `GameDB #${gameId} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let completionId: number;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      completionId = await Member.addCompletion({
        userId,
        gameId,
        completionType,
        completedAt,
        finalPlaytimeHours,
      });
    } catch (err: any) {
      const msg = err?.message ?? "Failed to save completion.";
      await interaction.followUp({
        content: `Could not save completion: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await Member.removeNowPlaying(userId, gameId);
    } catch {
      // Ignore cleanup errors
    }

    const dateText = completedAt ? formatDiscordTimestamp(completedAt) : "today";
    const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
    const details = [completionType, dateText, playtimeText].filter(Boolean).join(" — ");

    await interaction.followUp({
      content: `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
