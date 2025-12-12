var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { AttachmentBuilder, ApplicationCommandOptionType, EmbedBuilder, MessageFlags, PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, } from "discord.js";
import { readFileSync } from "fs";
import path from "path";
import { Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption, ButtonComponent, SlashChoice, } from "discordx";
import axios from "axios";
import Member from "../classes/Member.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { createIgdbSession, } from "../services/IgdbSelectService.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
const MAX_NOW_PLAYING = 10;
const COMPLETION_TYPES = [
    "Main Story",
    "Main Story + Side Content",
    "Completionist",
];
const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(process.cwd(), "src", "assets", "images", GAME_DB_THUMB_NAME);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);
function buildGameDbThumbAttachment() {
    return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}
function applyGameDbThumbnail(embed) {
    return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}
const completionAddSessions = new Map();
const nowPlayingAddSessions = new Map();
const COMPLETION_PAGE_SIZE = 20;
function parseDateInput(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
        return null;
    return parsed;
}
function clampLimit(limit, max) {
    if (!limit || Number.isNaN(limit))
        return Math.min(50, max);
    return Math.min(Math.max(limit, 1), max);
}
function parseCompletionDateInput(value) {
    if (!value)
        return new Date();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error("Could not parse completion date. Use a format like 2025-12-11.");
    }
    return parsed;
}
function formatPlaytimeHours(val) {
    if (val === null || val === undefined)
        return null;
    const rounded = Math.round(val * 100) / 100;
    return `${rounded} hours`;
}
function formatCompletionLine(record) {
    const date = record.completedAt ? formatDiscordTimestamp(record.completedAt) : "Date not set";
    const playtime = formatPlaytimeHours(record.finalPlaytimeHours);
    const extras = [date, playtime].filter(Boolean).join(" — ");
    return `${record.title} — ${record.completionType}${extras ? ` — ${extras}` : ""}`;
}
function formatTableDate(date) {
    if (!date)
        return "No date";
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
}
function summarizeFilters(filters) {
    const parts = [];
    if (filters.userId)
        parts.push(`userId~${filters.userId}`);
    if (filters.username)
        parts.push(`username~${filters.username}`);
    if (filters.globalName)
        parts.push(`globalName~${filters.globalName}`);
    if (filters.completionatorUrl)
        parts.push(`completionator~${filters.completionatorUrl}`);
    if (filters.steamUrl)
        parts.push(`steam~${filters.steamUrl}`);
    if (filters.psnUsername)
        parts.push(`psn~${filters.psnUsername}`);
    if (filters.xblUsername)
        parts.push(`xbl~${filters.xblUsername}`);
    if (filters.nswFriendCode)
        parts.push(`switch~${filters.nswFriendCode}`);
    if (filters.roleAdmin !== undefined)
        parts.push(`admin=${filters.roleAdmin ? 1 : 0}`);
    if (filters.roleModerator !== undefined)
        parts.push(`moderator=${filters.roleModerator ? 1 : 0}`);
    if (filters.roleRegular !== undefined)
        parts.push(`regular=${filters.roleRegular ? 1 : 0}`);
    if (filters.roleMember !== undefined)
        parts.push(`member=${filters.roleMember ? 1 : 0}`);
    if (filters.roleNewcomer !== undefined)
        parts.push(`newcomer=${filters.roleNewcomer ? 1 : 0}`);
    if (filters.isBot !== undefined)
        parts.push(`bot=${filters.isBot ? 1 : 0}`);
    if (filters.joinedAfter)
        parts.push(`joined>=${filters.joinedAfter.toISOString()}`);
    if (filters.joinedBefore)
        parts.push(`joined<=${filters.joinedBefore.toISOString()}`);
    if (filters.lastSeenAfter)
        parts.push(`seen>=${filters.lastSeenAfter.toISOString()}`);
    if (filters.lastSeenBefore)
        parts.push(`seen<=${filters.lastSeenBefore.toISOString()}`);
    parts.push(`includeDeparted=${filters.includeDeparted ? "yes" : "no"}`);
    return parts.join(" | ") || "none";
}
function chunkOptions(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
function formatDiscordTimestamp(value) {
    if (!value)
        return "Unknown";
    const seconds = Math.floor(value.getTime() / 1000);
    return `<t:${seconds}:F>`;
}
function buildProfileFields(record, nickHistory, nowPlaying, completions, guildId) {
    if (!record) {
        return [];
    }
    const fields = [];
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
        value: [
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
function buildAvatarAttachment(record) {
    if (!record?.avatarBlob)
        return null;
    return new AttachmentBuilder(record.avatarBlob, { name: "profile-avatar.png" });
}
function avatarBuffersDifferent(a, b) {
    if (!a && !b)
        return false;
    if (!!a !== !!b)
        return true;
    if (!a || !b)
        return true;
    if (a.length !== b.length)
        return true;
    return !a.equals(b);
}
async function downloadAvatar(url) {
    try {
        const resp = await axios.get(url, { responseType: "arraybuffer" });
        return Buffer.from(resp.data);
    }
    catch {
        return null;
    }
}
function buildBaseMemberRecord(user) {
    return {
        userId: user.id,
        isBot: user.bot ? 1 : 0,
        username: user.username ?? null,
        globalName: user.globalName ?? null,
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
export async function buildProfileViewPayload(target, guildId) {
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
            const baseRecord = record ?? buildBaseMemberRecord(target);
            if (newAvatar && avatarBuffersDifferent(baseRecord.avatarBlob, newAvatar)) {
                record = {
                    ...baseRecord,
                    avatarBlob: newAvatar,
                    username: target.username ?? baseRecord.username,
                    globalName: target.globalName ?? baseRecord.globalName,
                    isBot: target.bot ? 1 : 0,
                };
                await Member.upsert(record);
            }
            else if (!record) {
                record = baseRecord;
            }
        }
        if (!record) {
            return { notFoundMessage: `No profile data found for <@${target.id}>.` };
        }
        const nickHistory = [];
        for (const entry of nickHistoryEntries) {
            const candidateRaw = entry.oldNick ?? entry.newNick;
            const candidate = candidateRaw?.trim();
            if (!candidate)
                continue;
            if (candidate === record.globalName || candidate === record.username)
                continue;
            if (nickHistory.includes(candidate))
                continue;
            nickHistory.push(candidate);
            if (nickHistory.length >= 5)
                break;
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
        }
        else if (target.displayAvatarURL()) {
            embed.setThumbnail(target.displayAvatarURL());
        }
        return {
            payload: {
                embeds: [embed],
                files: attachment ? [attachment] : undefined,
            },
        };
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        return { errorMessage: `Error loading profile: ${msg}` };
    }
}
let ProfileCommand = class ProfileCommand {
    async profileView(member, showInChat, interaction) {
        const target = member ?? interaction.user;
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        const result = await buildProfileViewPayload(target, interaction.guildId ?? undefined);
        if (result.errorMessage) {
            await safeReply(interaction, {
                content: result.errorMessage,
                ephemeral,
            });
            return;
        }
        if (!result.payload) {
            await safeReply(interaction, {
                content: result.notFoundMessage ?? `No profile data found for <@${target.id}>.`,
                ephemeral,
            });
            return;
        }
        await safeReply(interaction, {
            ...result.payload,
            ephemeral,
        });
    }
    async completionAdd(completionType, gameId, query, completionDate, finalPlaytimeHours, fromNowPlaying, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        if (!COMPLETION_TYPES.includes(completionType)) {
            await safeReply(interaction, {
                content: "Invalid completion type.",
                ephemeral: true,
            });
            return;
        }
        let completedAt;
        try {
            completedAt = parseCompletionDateInput(completionDate);
        }
        catch (err) {
            await safeReply(interaction, {
                content: err?.message ?? "Invalid completion date.",
                ephemeral: true,
            });
            return;
        }
        if (finalPlaytimeHours !== undefined && (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)) {
            await safeReply(interaction, {
                content: "Final playtime must be a non-negative number of hours.",
                ephemeral: true,
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
                    ephemeral: true,
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
                .addOptions(list.slice(0, 25).map((entry) => ({
                label: entry.title.slice(0, 100),
                value: String(entry.gameId),
                description: `GameDB #${entry.gameId}`,
            })));
            await safeReply(interaction, {
                content: "Choose the game you just completed:",
                components: [new ActionRowBuilder().addComponents(select)],
                ephemeral: true,
            });
            return;
        }
        if (gameId) {
            const game = await Game.getGameById(Number(gameId));
            if (!game) {
                await safeReply(interaction, {
                    content: `GameDB #${gameId} was not found.`,
                    ephemeral: true,
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
                ephemeral: true,
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
    async completionList(year, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        await this.renderCompletionPage(interaction, interaction.user.id, 0, year ?? null, ephemeral);
    }
    async completionEdit(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
        if (!completions.length) {
            await safeReply(interaction, {
                content: "You have no completions to edit.",
                ephemeral: true,
            });
            return;
        }
        const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const lines = completions.map((c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`);
        const buttons = completions.map((c, idx) => new ButtonBuilder()
            .setCustomId(`comp-edit:${interaction.user.id}:${c.completionId}`)
            .setLabel(emojis[idx])
            .setStyle(ButtonStyle.Primary));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        await safeReply(interaction, {
            content: "Select a completion to edit:",
            embeds: [
                new EmbedBuilder()
                    .setTitle("Your Completions")
                    .setDescription(lines.join("\n")),
            ],
            components: rows,
            ephemeral: true,
        });
    }
    async completionDelete(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
        if (!completions.length) {
            await safeReply(interaction, {
                content: "You have no completions to delete.",
                ephemeral: true,
            });
            return;
        }
        const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const lines = completions.map((c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`);
        const buttons = completions.map((c, idx) => new ButtonBuilder()
            .setCustomId(`comp-del:${interaction.user.id}:${c.completionId}`)
            .setLabel(emojis[idx])
            .setStyle(ButtonStyle.Danger));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        await safeReply(interaction, {
            content: "Select a completion to delete:",
            embeds: [
                new EmbedBuilder()
                    .setTitle("Your Completions")
                    .setDescription(lines.join("\n")),
            ],
            components: rows,
            ephemeral: true,
        });
    }
    async handleCompletionAddSelect(interaction) {
        const [, sessionId] = interaction.customId.split(":");
        const ctx = completionAddSessions.get(sessionId);
        if (!ctx) {
            await interaction
                .reply({
                content: "This completion prompt has expired.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        if (interaction.user.id !== ctx.userId) {
            await interaction
                .reply({
                content: "This completion prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const value = interaction.values?.[0];
        if (!value) {
            await interaction
                .reply({
                content: "No selection received.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        await interaction.deferUpdate().catch(() => { });
        try {
            await this.processCompletionSelection(interaction, value, ctx);
        }
        finally {
            completionAddSessions.delete(sessionId);
            try {
                await interaction.editReply({ components: [] }).catch(() => { });
            }
            catch {
                // ignore
            }
        }
    }
    async handleCompletionDeleteButton(interaction) {
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
            await interaction.message.edit({ components: [] }).catch(() => { });
        }
        catch {
            // ignore
        }
    }
    async handleCompletionEditSelect(interaction) {
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
                new EmbedBuilder().setDescription(`Current: ${completion.completionType} — ${completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date"}${completion.finalPlaytimeHours != null ? ` — ${formatPlaytimeHours(completion.finalPlaytimeHours)}` : ""}`),
            ],
            components: [new ActionRowBuilder().addComponents(fieldButtons)],
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleCompletionFieldEdit(interaction) {
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
        const prompt = field === "type"
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
        const collected = await channel
            .awaitMessages({
            filter: (m) => m.author.id === interaction.user.id,
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
                const normalized = COMPLETION_TYPES.find((t) => t.toLowerCase() === value.toLowerCase());
                if (!normalized) {
                    throw new Error("Invalid completion type.");
                }
                await Member.updateCompletion(ownerId, completionId, { completionType: normalized });
            }
            else if (field === "date") {
                const dt = parseCompletionDateInput(value);
                await Member.updateCompletion(ownerId, completionId, { completedAt: dt });
            }
            else if (field === "playtime") {
                const num = Number(value);
                if (Number.isNaN(num) || num < 0)
                    throw new Error("Playtime must be a non-negative number.");
                await Member.updateCompletion(ownerId, completionId, { finalPlaytimeHours: num });
            }
            await interaction.followUp({
                content: "Completion updated.",
                flags: MessageFlags.Ephemeral,
            });
        }
        catch (err) {
            await interaction.followUp({
                content: err?.message ?? "Failed to update completion.",
                flags: MessageFlags.Ephemeral,
            });
        }
        finally {
            try {
                await message.delete().catch(() => { });
            }
            catch {
                // ignore
            }
        }
    }
    async handleCompletionListPaging(interaction) {
        const [, ownerId, yearRaw, pageRaw, dir] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This list isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const page = Number(pageRaw);
        if (Number.isNaN(page))
            return;
        const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
        const year = yearRaw ? Number(yearRaw) : null;
        const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        await this.renderCompletionPage(interaction, ownerId, nextPage, Number.isNaN(year ?? NaN) ? null : year, ephemeral);
    }
    async addNowPlaying(query, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        try {
            const results = await Game.searchGames(query);
            const sessionId = `np-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            nowPlayingAddSessions.set(sessionId, { userId: interaction.user.id, query });
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
            const selectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(selectId)
                .setPlaceholder("Select the game to add")
                .addOptions(options));
            await safeReply(interaction, {
                content: "Select the game to add to your Now Playing list:",
                components: [selectRow],
                ephemeral: true,
            });
            setTimeout(async () => {
                try {
                    const reply = (await interaction.fetchReply());
                    const hasActiveComponents = reply.components.some((row) => {
                        if (!("components" in row))
                            return false;
                        const actionRow = row;
                        return actionRow.components.length > 0;
                    });
                    if (!hasActiveComponents)
                        return;
                    await interaction.editReply({
                        content: "Timed out waiting for a selection. No changes made.",
                        components: [],
                    });
                }
                catch {
                    // ignore
                }
            }, 60_000);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not add to Now Playing: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async handleAddNowPlayingSelect(interaction) {
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
            await Member.addNowPlaying(ownerId, gameId);
            const list = await Member.getNowPlaying(ownerId);
            await interaction.update({
                content: `Added **${game.title}** to your Now Playing list (${list.length}/${MAX_NOW_PLAYING}).`,
                components: [],
            });
            nowPlayingAddSessions.delete(sessionId);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.update({
                content: `Could not add to Now Playing: ${msg}`,
                components: [],
            });
        }
    }
    async removeNowPlaying(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        try {
            const current = await Member.getNowPlayingEntries(interaction.user.id);
            if (!current.length) {
                await safeReply(interaction, {
                    content: "Your Now Playing list is empty.",
                    ephemeral: true,
                });
                return;
            }
            const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
            const lines = current.slice(0, emojis.length).map((entry, idx) => `${emojis[idx]} ${entry.title} (GameDB #${entry.gameId})`);
            const buttons = current.slice(0, emojis.length).map((entry, idx) => new ButtonBuilder()
                .setCustomId(`np-remove:${interaction.user.id}:${entry.gameId}`)
                .setLabel(`${idx + 1}`)
                .setStyle(ButtonStyle.Primary));
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) {
                rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }
            await safeReply(interaction, {
                content: "Select a game to remove from your Now Playing list:",
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Now Playing")
                        .setDescription(lines.join("\n")),
                ],
                components: rows,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not remove from Now Playing: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async handleRemoveNowPlayingButton(interaction) {
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
                await interaction.message.edit({ components: [] }).catch(() => { });
            }
            catch {
                // ignore
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.reply({
                content: `Could not remove from Now Playing: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async handleProfileSearchSelect(interaction) {
        const userId = interaction.values?.[0];
        if (!userId) {
            await safeReply(interaction, {
                content: "Could not determine which member to load.",
                ephemeral: true,
            });
            return;
        }
        await safeDeferReply(interaction, { ephemeral: true });
        try {
            const user = await interaction.client.users.fetch(userId);
            const result = await buildProfileViewPayload(user, interaction.guildId ?? undefined);
            if (result.errorMessage) {
                await safeReply(interaction, {
                    content: result.errorMessage,
                    ephemeral: true,
                });
                return;
            }
            if (!result.payload) {
                await safeReply(interaction, {
                    content: result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
                    ephemeral: true,
                });
                return;
            }
            await safeReply(interaction, {
                ...result.payload,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not load that profile: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async profileSearch(showInChat, userId, username, globalName, completionator, steam, psn, xbl, nsw, roleAdmin, roleModerator, roleRegular, roleMember, roleNewcomer, isBot, joinedAfter, joinedBefore, lastSeenAfter, lastSeenBefore, limit, includeDeparted, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        const joinedAfterDate = parseDateInput(joinedAfter);
        const joinedBeforeDate = parseDateInput(joinedBefore);
        const lastSeenAfterDate = parseDateInput(lastSeenAfter);
        const lastSeenBeforeDate = parseDateInput(lastSeenBefore);
        if (joinedAfter && !joinedAfterDate) {
            await safeReply(interaction, {
                content: "Invalid joinedafter date/time. Please use an ISO format.",
                ephemeral,
            });
            return;
        }
        if (joinedBefore && !joinedBeforeDate) {
            await safeReply(interaction, {
                content: "Invalid joinedbefore date/time. Please use an ISO format.",
                ephemeral,
            });
            return;
        }
        if (lastSeenAfter && !lastSeenAfterDate) {
            await safeReply(interaction, {
                content: "Invalid lastseenafter date/time. Please use an ISO format.",
                ephemeral,
            });
            return;
        }
        if (lastSeenBefore && !lastSeenBeforeDate) {
            await safeReply(interaction, {
                content: "Invalid lastseenbefore date/time. Please use an ISO format.",
                ephemeral,
            });
            return;
        }
        const filters = {
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
                ephemeral,
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
        const components = selectChunks.slice(0, 5).map((chunk, idx) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`profile-search-select-${idx}`)
            .setPlaceholder("Select a member to view their profile")
            .addOptions(chunk)
            .setMinValues(1)
            .setMaxValues(1)));
        const embed = new EmbedBuilder()
            .setTitle(`Profile search (${results.length})`)
            .setDescription(description.slice(0, 4000))
            .setFooter({ text: "Choose a member below to view a profile." });
        const content = selectChunks.length > 5
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
    async profileEdit(member, completionator, psn, xbl, nsw, steam, interaction) {
        const target = member ?? interaction.user;
        const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
        const isSelf = target.id === interaction.user.id;
        const ephemeral = true;
        await safeDeferReply(interaction, { ephemeral });
        if (!isSelf && !isAdmin) {
            await safeReply(interaction, {
                content: "You can only edit your own profile.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (completionator === undefined &&
            psn === undefined &&
            xbl === undefined &&
            nsw === undefined &&
            steam === undefined) {
            await safeReply(interaction, {
                content: "Provide at least one field to update.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            const existing = (await Member.getByUserId(target.id)) ?? buildBaseMemberRecord(target);
            const updated = {
                ...existing,
                username: existing.username ?? target.username ?? null,
                globalName: existing.globalName ?? target.globalName ?? null,
                completionatorUrl: completionator !== undefined ? completionator || null : existing.completionatorUrl,
                psnUsername: psn !== undefined ? psn || null : existing.psnUsername,
                xblUsername: xbl !== undefined ? xbl || null : existing.xblUsername,
                nswFriendCode: nsw !== undefined ? nsw || null : existing.nswFriendCode,
                steamUrl: steam !== undefined ? steam || null : existing.steamUrl,
            };
            await Member.upsert(updated);
            const changedFields = [];
            if (completionator !== undefined)
                changedFields.push("Completionator");
            if (psn !== undefined)
                changedFields.push("PSN");
            if (xbl !== undefined)
                changedFields.push("Xbox");
            if (nsw !== undefined)
                changedFields.push("Switch");
            if (steam !== undefined)
                changedFields.push("Steam");
            await safeReply(interaction, {
                content: `Updated profile for <@${target.id}> (${changedFields.join(", ")}).`,
                flags: MessageFlags.Ephemeral,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error updating profile: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    createCompletionSession(ctx) {
        const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        completionAddSessions.set(sessionId, ctx);
        return sessionId;
    }
    async renderCompletionPage(interaction, userId, page, year, ephemeral) {
        const total = await Member.countCompletions(userId, year);
        if (total === 0) {
            await safeReply(interaction, {
                content: year ? `You have no recorded completions for ${year}.` : "You have no recorded completions yet.",
                ephemeral,
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
            await safeReply(interaction, {
                content: "You have no recorded completions yet.",
                ephemeral,
            });
            return;
        }
        const maxIndexLabelLength = `${offset + completions.length}.`.length;
        const dateWidth = 10; // MM/DD/YYYY
        const counts = {};
        const grouped = completions.reduce((acc, c) => {
            const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
            acc[yr] = acc[yr] || [];
            counts[yr] = (counts[yr] ?? 0) + 1;
            const idxLabelRaw = `${counts[yr]}.`;
            const idxLabel = idxLabelRaw.padStart(maxIndexLabelLength, " ");
            const formattedDate = formatTableDate(c.completedAt);
            const dateLabel = formattedDate.padStart(dateWidth, " ");
            const typeAbbrev = c.completionType === "Main Story"
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
        const authorName = interaction.user?.displayName ??
            interaction.user?.username ??
            "User";
        const authorIcon = interaction.user?.displayAvatarURL?.({
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
            if (a === "Unknown")
                return 1;
            if (b === "Unknown")
                return -1;
            return Number(b) - Number(a);
        });
        const addChunkedField = (yr, content, chunkIndex) => {
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
            const flush = () => {
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
                }
                else {
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
        const components = totalPages > 1
            ? [new ActionRowBuilder().addComponents(prev, next)]
            : [];
        const footerLines = [
            "M = Main Story • M+S = Main Story + Side Content • C = Completionist",
        ];
        if (totalPages > 1) {
            footerLines.push(`${total} results. Page ${safePage + 1} of ${totalPages}.`);
        }
        embed.setFooter({ text: footerLines.join("\n") });
        await safeReply(interaction, {
            embeds: [embed],
            files: [buildGameDbThumbAttachment()],
            components,
            ephemeral,
        });
    }
    async promptCompletionSelection(interaction, searchTerm, ctx) {
        const localResults = await Game.searchGames(searchTerm);
        if (localResults.length) {
            const sessionId = this.createCompletionSession(ctx);
            const select = new StringSelectMenuBuilder()
                .setCustomId(`completion-add-select:${sessionId}`)
                .setPlaceholder("Select a game to log completion")
                .addOptions(localResults.slice(0, 25).map((game) => ({
                label: game.title.slice(0, 100),
                value: String(game.id),
                description: `GameDB #${game.id}`,
            })));
            await safeReply(interaction, {
                content: `Select the game for "${searchTerm}".`,
                components: [new ActionRowBuilder().addComponents(select)],
                ephemeral: true,
            });
            return;
        }
        const igdbSearch = await igdbService.searchGames(searchTerm);
        if (!igdbSearch.results.length) {
            await safeReply(interaction, {
                content: `No GameDB or IGDB matches found for "${searchTerm}".`,
                ephemeral: true,
            });
            return;
        }
        const opts = igdbSearch.results.map((game) => {
            const year = game.first_release_date
                ? new Date(game.first_release_date * 1000).getFullYear()
                : "TBD";
            return {
                id: game.id,
                label: `${game.name} (${year})`,
                description: (game.summary || "No summary").slice(0, 95),
            };
        });
        const { components } = createIgdbSession(interaction.user.id, opts, async (sel, gameId) => {
            const imported = await this.importGameFromIgdb(gameId);
            await this.saveCompletion(sel, ctx.userId, imported.gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, imported.title);
        });
        await safeReply(interaction, {
            content: `No GameDB match; select an IGDB result to import for "${searchTerm}".`,
            components,
            ephemeral: true,
        });
    }
    async processCompletionSelection(interaction, value, ctx) {
        if (!interaction.deferred && !interaction.replied) {
            try {
                await interaction.deferUpdate();
            }
            catch {
                // ignore
            }
        }
        try {
            let gameId = null;
            let gameTitle = null;
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
            }
            else {
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
            await this.saveCompletion(interaction, ctx.userId, gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, gameTitle ?? undefined);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.followUp({
                content: `Failed to add completion: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async importGameFromIgdb(igdbId) {
        const existing = await Game.getGameByIgdbId(igdbId);
        if (existing) {
            return { gameId: existing.id, title: existing.title };
        }
        const details = await igdbService.getGameDetails(igdbId);
        if (!details) {
            throw new Error("Failed to load game details from IGDB.");
        }
        const newGame = await Game.createGame(details.name, details.summary ?? "", null, details.id, details.slug ?? null, details.total_rating ?? null, details.url ?? null);
        await Game.saveFullGameMetadata(newGame.id, details);
        return { gameId: newGame.id, title: details.name };
    }
    async startNowPlayingIgdbImport(interaction, session) {
        try {
            const searchRes = await igdbService.searchGames(session.query);
            if (!searchRes.results.length) {
                await interaction.update({
                    content: `No IGDB results found for "${session.query}".`,
                    components: [],
                });
                return;
            }
            const opts = searchRes.results.map((game) => {
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
                    await Member.addNowPlaying(session.userId, imported.gameId);
                    const list = await Member.getNowPlaying(session.userId);
                    await sel.update({
                        content: `Imported **${imported.title}** and added to Now Playing (${list.length}/${MAX_NOW_PLAYING}).`,
                        components: [],
                    });
                }
                catch (err) {
                    const msg = err?.message ?? "Failed to import from IGDB.";
                    await sel.reply({
                        content: msg,
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => { });
                }
            });
            await interaction.update({
                content: "Select an IGDB result to import and add to Now Playing:",
                components,
            });
        }
        catch (err) {
            const msg = err?.message ?? "Failed to search IGDB.";
            await interaction.update({
                content: msg,
                components: [],
            });
        }
    }
    async saveCompletion(interaction, userId, gameId, completionType, completedAt, finalPlaytimeHours, gameTitle) {
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
        let completionId;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            completionId = await Member.addCompletion({
                userId,
                gameId,
                completionType,
                completedAt,
                finalPlaytimeHours,
            });
        }
        catch (err) {
            const msg = err?.message ?? "Failed to save completion.";
            await interaction.followUp({
                content: `Could not save completion: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            await Member.removeNowPlaying(userId, gameId);
        }
        catch {
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
};
__decorate([
    Slash({ description: "Show a member profile", name: "view" }),
    SlashGroup("profile"),
    __param(0, SlashOption({
        description: "Member to view; leave blank to view your own profile.",
        name: "member",
        required: false,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "If true, post in channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], ProfileCommand.prototype, "profileView", null);
__decorate([
    Slash({ description: "Add a game completion", name: "completion-add" }),
    SlashGroup("profile"),
    __param(0, SlashChoice(...COMPLETION_TYPES.map((t) => ({
        name: t,
        value: t,
    })))),
    __param(0, SlashOption({
        description: "Type of completion",
        name: "completion_type",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "GameDB id (optional if using query/from_now_playing)",
        name: "game_id",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(2, SlashOption({
        description: "Search text to find/import the game",
        name: "query",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Completion date (defaults to today)",
        name: "completion_date",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Final playtime in hours (e.g., 12.5)",
        name: "final_playtime_hours",
        required: false,
        type: ApplicationCommandOptionType.Number,
    })),
    __param(5, SlashOption({
        description: "Pick a game from your Now Playing list",
        name: "from_now_playing",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], ProfileCommand.prototype, "completionAdd", null);
__decorate([
    Slash({ description: "List your completed games", name: "completion-list" }),
    SlashGroup("profile"),
    __param(0, SlashOption({
        description: "Filter to a specific year (optional)",
        name: "year",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "If true, show in channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], ProfileCommand.prototype, "completionList", null);
__decorate([
    Slash({ description: "Edit one of your completion records", name: "completion-edit" }),
    SlashGroup("profile")
], ProfileCommand.prototype, "completionEdit", null);
__decorate([
    Slash({ description: "Delete one of your completion records", name: "completion-delete" }),
    SlashGroup("profile")
], ProfileCommand.prototype, "completionDelete", null);
__decorate([
    SelectMenuComponent({ id: /^completion-add-select:.+/ })
], ProfileCommand.prototype, "handleCompletionAddSelect", null);
__decorate([
    ButtonComponent({ id: /^comp-del:[^:]+:\d+$/ })
], ProfileCommand.prototype, "handleCompletionDeleteButton", null);
__decorate([
    ButtonComponent({ id: /^comp-edit:[^:]+:\d+$/ })
], ProfileCommand.prototype, "handleCompletionEditSelect", null);
__decorate([
    ButtonComponent({ id: /^comp-edit-field:[^:]+:\d+:(type|date|playtime)$/ })
], ProfileCommand.prototype, "handleCompletionFieldEdit", null);
__decorate([
    ButtonComponent({ id: /^comp-list-page:[^:]+:[^:]*:\d+:(prev|next)$/ })
], ProfileCommand.prototype, "handleCompletionListPaging", null);
__decorate([
    Slash({ description: "Add a game to your Now Playing list", name: "nowplaying-add" }),
    SlashGroup("profile"),
    __param(0, SlashOption({
        description: "Search text to find the game in GameDB",
        name: "query",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], ProfileCommand.prototype, "addNowPlaying", null);
__decorate([
    SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
], ProfileCommand.prototype, "handleAddNowPlayingSelect", null);
__decorate([
    Slash({ description: "Remove a game from your Now Playing list", name: "nowplaying-remove" }),
    SlashGroup("profile")
], ProfileCommand.prototype, "removeNowPlaying", null);
__decorate([
    ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
], ProfileCommand.prototype, "handleRemoveNowPlayingButton", null);
__decorate([
    SelectMenuComponent({ id: /^profile-search-select-\d+$/ })
], ProfileCommand.prototype, "handleProfileSearchSelect", null);
__decorate([
    Slash({ description: "Search member profiles", name: "search" }),
    SlashGroup("profile"),
    __param(0, SlashOption({
        description: "If true, post in channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Filter by user id.",
        name: "userid",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Filter by username (contains).",
        name: "username",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Filter by global display name (contains).",
        name: "globalname",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Filter by Game Collection Tracker URL (contains).",
        name: "completionator",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(5, SlashOption({
        description: "Filter by Steam URL (contains).",
        name: "steam",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(6, SlashOption({
        description: "Filter by PlayStation Network username (contains).",
        name: "psn",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(7, SlashOption({
        description: "Filter by Xbox Live username (contains).",
        name: "xbl",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(8, SlashOption({
        description: "Filter by Nintendo Switch friend code (contains).",
        name: "switch",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(9, SlashOption({
        description: "Filter by Admin role flag (1 or 0).",
        name: "admin",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(10, SlashOption({
        description: "Filter by Moderator role flag (1 or 0).",
        name: "moderator",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(11, SlashOption({
        description: "Filter by Regular role flag (1 or 0).",
        name: "regular",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(12, SlashOption({
        description: "Filter by Member role flag (1 or 0).",
        name: "member",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(13, SlashOption({
        description: "Filter by Newcomer role flag (1 or 0).",
        name: "newcomer",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(14, SlashOption({
        description: "Filter by bot flag (1 or 0).",
        name: "bot",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(15, SlashOption({
        description: "Joined server on/after (ISO date/time).",
        name: "joinedafter",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(16, SlashOption({
        description: "Joined server on/before (ISO date/time).",
        name: "joinedbefore",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(17, SlashOption({
        description: "Last seen on/after (ISO date/time).",
        name: "lastseenafter",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(18, SlashOption({
        description: "Last seen on/before (ISO date/time).",
        name: "lastseenbefore",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(19, SlashOption({
        description: "Max results to return (1-50).",
        name: "limit",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(20, SlashOption({
        description: "Include departed members (SERVER_LEFT_AT not null).",
        name: "include-departed-members",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], ProfileCommand.prototype, "profileSearch", null);
__decorate([
    Slash({ description: "Edit profile links (self, or any user if admin)", name: "edit" }),
    SlashGroup("profile"),
    __param(0, SlashOption({
        description: "Member to edit; admin only.",
        name: "member",
        required: false,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "Game Collection Tracker URL.",
        name: "completionator",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "PlayStation Network username.",
        name: "psn",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Xbox Live username.",
        name: "xbl",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Nintendo Switch friend code.",
        name: "nsw",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(5, SlashOption({
        description: "Steam profile URL.",
        name: "steam",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], ProfileCommand.prototype, "profileEdit", null);
ProfileCommand = __decorate([
    SlashGroup({ description: "Profile commands", name: "profile" }),
    Discord()
], ProfileCommand);
export { ProfileCommand };
