var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { AttachmentBuilder, ApplicationCommandOptionType, EmbedBuilder, MessageFlags, PermissionsBitField, ActionRowBuilder, StringSelectMenuBuilder, } from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import axios from "axios";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
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
function buildProfileFields(record) {
    if (!record) {
        return [];
    }
    const fields = [];
    const globalName = record.globalName ?? "Unknown";
    if (globalName !== "Unknown") {
        fields.push({ label: "Global Name", value: globalName, inline: true });
    }
    fields.push({
        label: "Last Seen",
        value: formatDiscordTimestamp(record.lastSeenAt),
        inline: true,
    });
    fields.push({
        label: "Joined Server",
        value: formatDiscordTimestamp(record.serverJoinedAt),
        inline: true,
    });
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
    });
    if (record.isBot) {
        fields.push({ label: "Bot", value: "Yes", inline: true });
    }
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
export async function buildProfileViewPayload(target) {
    try {
        let record = await Member.getByUserId(target.id);
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
        const fields = buildProfileFields(record).map((f) => ({
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
        const result = await buildProfileViewPayload(target);
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
