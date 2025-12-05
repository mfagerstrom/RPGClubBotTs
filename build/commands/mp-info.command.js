var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, ApplicationCommandOptionType, } from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashOption } from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { buildProfileViewPayload } from "./profile.command.js";
const MAX_OPTIONS = 25;
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
function buildSummaryEmbed(members, filters) {
    const lines = members.map((member, idx) => {
        const platforms = formatPlatforms(member, filters);
        return `${idx + 1}. <@${member.userId}> — ${platforms}`;
    });
    const embed = new EmbedBuilder()
        .setTitle("Member Multiplayer Info")
        .setDescription(lines.join("\n") || "No member platform data found.")
        .setFooter({
        text: "Want to list your multiplayer info? Use /profile edit\n\nSelect a member below to view a profile.",
    });
    const options = members.slice(0, MAX_OPTIONS).map((member) => {
        const name = member.globalName ?? member.username ?? "Unknown member";
        const platforms = formatPlatforms(member, filters) || "Platforms not listed";
        return {
            label: name.slice(0, 100),
            value: member.userId,
            description: platforms.slice(0, 100),
        };
    });
    const select = new StringSelectMenuBuilder()
        .setCustomId("mpinfo-select")
        .setPlaceholder("Select a member to view their profile")
        .addOptions(options)
        .setMinValues(1)
        .setMaxValues(1);
    const components = [new ActionRowBuilder().addComponents(select)];
    const note = members.length > MAX_OPTIONS
        ? `Dropdown shows the first ${MAX_OPTIONS} of ${members.length} members.`
        : undefined;
    return { embed, components, note };
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
        await safeDeferReply(interaction, { ephemeral });
        const anyIncluded = filters.steam || filters.xbl || filters.psn || filters.nsw;
        if (!anyIncluded) {
            await safeReply(interaction, {
                content: "Please enable at least one platform filter.",
                ephemeral,
            });
            return;
        }
        const members = await Member.getMembersWithPlatforms();
        const filtered = members.filter((member) => hasAnyPlatform(member, filters));
        if (!filtered.length) {
            await safeReply(interaction, {
                content: "No members match the selected platforms.",
                ephemeral,
            });
            return;
        }
        const { embed, components, note } = buildSummaryEmbed(filtered, filters);
        await safeReply(interaction, {
            content: note,
            embeds: [embed],
            components,
            ephemeral,
        });
    }
    async handleProfileSelect(interaction) {
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
            const result = await buildProfileViewPayload(user);
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
    SelectMenuComponent({ id: "mpinfo-select" })
], MultiplayerInfoCommand.prototype, "handleProfileSelect", null);
MultiplayerInfoCommand = __decorate([
    Discord()
], MultiplayerInfoCommand);
export { MultiplayerInfoCommand };
