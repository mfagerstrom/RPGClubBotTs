var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, ApplicationCommandOptionType, MessageFlags, ButtonBuilder, ButtonStyle, } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashOption, } from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildProfileViewPayload } from "./profile.command.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
const MAX_OPTIONS = 25;
const PAGE_SIZE = 20;
const GUILD_FETCH_CHUNK_SIZE = 100;
function hasAnyPlatform(record, filters) {
    if (filters.steam && record.steamUrl)
        return true;
    if (filters.xbl && record.xblUsername)
        return true;
    if (filters.psn && record.psnUsername)
        return true;
    if (filters.nsw && record.nswFriendCode)
        return true;
    return false;
}
function formatPlatforms(record, filters) {
    const platforms = [];
    if (filters.steam && record.steamUrl)
        platforms.push("Steam");
    if (filters.xbl && record.xblUsername)
        platforms.push("Xbox Live");
    if (filters.psn && record.psnUsername)
        platforms.push("PSN");
    if (filters.nsw && record.nswFriendCode)
        platforms.push("Switch");
    return platforms.join(", ");
}
function encodeFilters(filters) {
    return [
        filters.steam ? "1" : "0",
        filters.xbl ? "1" : "0",
        filters.psn ? "1" : "0",
        filters.nsw ? "1" : "0",
    ].join("");
}
function decodeFilters(key) {
    const chars = key.split("");
    return {
        steam: chars[0] === "1",
        xbl: chars[1] === "1",
        psn: chars[2] === "1",
        nsw: chars[3] === "1",
    };
}
function chunkIds(ids, size) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += size) {
        chunks.push(ids.slice(i, i + size));
    }
    return chunks;
}
async function filterActiveGuildMembers(members, guild) {
    if (!guild || members.length === 0)
        return members;
    const ids = members.map((member) => member.userId);
    const chunks = chunkIds(ids, GUILD_FETCH_CHUNK_SIZE);
    const present = new Set();
    for (const chunk of chunks) {
        try {
            const fetched = await guild.members.fetch({ user: chunk });
            fetched.forEach((member) => present.add(member.id));
        }
        catch {
            // ignore fetch errors and fall back to cached entries
            chunk.forEach((id) => {
                if (guild.members.cache.has(id)) {
                    present.add(id);
                }
            });
        }
    }
    return members.filter((member) => present.has(member.userId));
}
function buildSummaryEmbed(members, filters, page) {
    const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const offset = safePage * PAGE_SIZE;
    const pageMembers = members.slice(offset, offset + PAGE_SIZE);
    const lines = pageMembers.map((member, idx) => {
        const displayIndex = offset + idx + 1;
        const platforms = formatPlatforms(member, filters);
        return `${displayIndex}. <@${member.userId}> — ${platforms}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("Member Multiplayer Info")
        .setDescription(lines.join("\n") || "No member platform data found.")
        .setFooter({ text: "Want to list your multiplayer info? Use /profile edit" });
    if (totalPages > 1) {
        const footerText = [
            "Want to list your multiplayer info? Use /profile edit",
            `Page ${safePage + 1} of ${totalPages}.`,
        ].join("\n");
        embed.setFooter({ text: footerText });
    }
    return { embed, totalPages, safePage, pageMembers };
}
function buildPageComponents(members, filters, ownerId, page, totalPages, pageMembers) {
    const filterKey = encodeFilters(filters);
    const options = pageMembers.slice(0, MAX_OPTIONS).map((member) => {
        const name = member.globalName ?? member.username ?? "Unknown member";
        const platforms = formatPlatforms(member, filters) || "Platforms not listed";
        return {
            label: name.slice(0, 100),
            value: member.userId,
            description: platforms.slice(0, 100),
        };
    });
    const components = [];
    const select = new StringSelectMenuBuilder()
        .setCustomId(`mpinfo-select:${ownerId}:${filterKey}:${page}`)
        .setPlaceholder("Select a member to view their profile")
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(1);
    components.push(new ActionRowBuilder().addComponents(select));
    if (totalPages > 1) {
        const prevDisabled = page <= 0;
        const nextDisabled = page >= totalPages - 1;
        const prev = new ButtonBuilder()
            .setCustomId(`mpinfo-page:${ownerId}:${filterKey}:${page}:prev`)
            .setLabel("Previous Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(prevDisabled);
        const next = new ButtonBuilder()
            .setCustomId(`mpinfo-page:${ownerId}:${filterKey}:${page}:next`)
            .setLabel("Next Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(nextDisabled);
        if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
            components.push(new ActionRowBuilder().addComponents(prev, next));
        }
    }
    return components;
}
async function renderMpInfoPage(interaction, filters, ownerId, page, ephemeral) {
    const members = await Member.getMembersWithPlatforms();
    const filtered = members.filter((member) => hasAnyPlatform(member, filters));
    const activeMembers = await filterActiveGuildMembers(filtered, interaction.guild);
    if (!activeMembers.length) {
        await safeReply(interaction, {
            content: "No members match the selected platforms.",
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
        return;
    }
    const { embed, totalPages, safePage, pageMembers } = buildSummaryEmbed(activeMembers, filters, page);
    const components = buildPageComponents(activeMembers, filters, ownerId, safePage, totalPages, pageMembers);
    if (interaction.isMessageComponent()) {
        await safeUpdate(interaction, {
            embeds: [embed],
            components,
            attachments: [],
        });
    }
    else {
        await safeReply(interaction, {
            embeds: [embed],
            components,
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
    }
}
let MultiplayerInfoCommand = class MultiplayerInfoCommand {
    async mpInfo(showInChat, steam, xbl, psn, nsw, interaction) {
        const anyExplicitTrue = [steam, xbl, psn, nsw].some((val) => val === true);
        const filters = anyExplicitTrue
            ? {
                steam: steam === true,
                xbl: xbl === true,
                psn: psn === true,
                nsw: nsw === true,
            }
            : {
                steam: steam ?? true,
                xbl: xbl ?? true,
                psn: psn ?? true,
                nsw: nsw ?? true,
            };
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        const anyIncluded = filters.steam || filters.xbl || filters.psn || filters.nsw;
        if (!anyIncluded) {
            await safeReply(interaction, {
                content: "Please enable at least one platform filter.",
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return;
        }
        await renderMpInfoPage(interaction, filters, interaction.user.id, 0, ephemeral);
    }
    async handleProfileSelect(interaction) {
        const [, ownerId, filterKey, pageRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await safeReply(interaction, {
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const userId = interaction.values?.[0];
        if (!userId) {
            await safeReply(interaction, {
                content: "Could not determine which member to load.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
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
                    content: result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const components = interaction.message.components ?? [];
            const content = interaction.message.content ?? null;
            const backButton = new ButtonBuilder()
                .setCustomId(`mpinfo-back:${ownerId}:${filterKey}:${pageRaw}`)
                .setLabel("Back to List")
                .setStyle(ButtonStyle.Secondary);
            const backRow = new ActionRowBuilder().addComponents(backButton);
            const filteredComponents = components.filter((row) => {
                if (!("components" in row))
                    return true;
                const actionRow = row;
                return !actionRow.components.some((component) => component.customId?.startsWith("mpinfo-back:"));
            });
            await safeUpdate(interaction, {
                ...result.payload,
                components: [...filteredComponents, backRow],
                content,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not load that profile: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async handleBackToList(interaction) {
        const [, ownerId, filterKey, pageRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await safeReply(interaction, {
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const page = Number(pageRaw);
        if (Number.isNaN(page))
            return;
        const filters = decodeFilters(filterKey);
        await renderMpInfoPage(interaction, filters, ownerId, page, true);
    }
    async handlePageButton(interaction) {
        const [, ownerId, filterKey, pageRaw, dir] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await safeReply(interaction, {
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const page = Number(pageRaw);
        if (Number.isNaN(page))
            return;
        const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
        const filters = decodeFilters(filterKey);
        await renderMpInfoPage(interaction, filters, ownerId, nextPage, true);
    }
};
__decorate([
    Slash({ description: "Show members with multiplayer handles", name: "mp-info" }),
    __param(0, SlashOption({
        description: "If true, post in channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Include Steam users.",
        name: "steam",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(2, SlashOption({
        description: "Include Xbox Live users.",
        name: "xbl",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(3, SlashOption({
        description: "Include PlayStation Network users.",
        name: "psn",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(4, SlashOption({
        description: "Include Nintendo Switch users.",
        name: "switch",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], MultiplayerInfoCommand.prototype, "mpInfo", null);
__decorate([
    SelectMenuComponent({ id: /^mpinfo-select:\d+:[01]{4}:\d+$/ })
], MultiplayerInfoCommand.prototype, "handleProfileSelect", null);
__decorate([
    ButtonComponent({ id: /^mpinfo-back:\d+:[01]{4}:\d+$/ })
], MultiplayerInfoCommand.prototype, "handleBackToList", null);
__decorate([
    ButtonComponent({ id: /^mpinfo-page:\d+:[01]{4}:\d+:(prev|next)$/ })
], MultiplayerInfoCommand.prototype, "handlePageButton", null);
MultiplayerInfoCommand = __decorate([
    Discord()
], MultiplayerInfoCommand);
export { MultiplayerInfoCommand };
