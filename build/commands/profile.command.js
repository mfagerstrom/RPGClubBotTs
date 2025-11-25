var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { AttachmentBuilder, ApplicationCommandOptionType, EmbedBuilder, } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import axios from "axios";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
function formatDate(value) {
    if (!value)
        return "Unknown";
    return value.toLocaleString();
}
function buildProfileFields(record) {
    if (!record) {
        return [];
    }
    const fields = [];
    fields.push({ label: "Username", value: record.username ?? "Unknown", inline: true });
    const globalName = record.globalName ?? "Unknown";
    if (globalName !== "Unknown") {
        fields.push({ label: "Global Name", value: globalName, inline: true });
    }
    fields.push({ label: "Last Seen", value: formatDate(record.lastSeenAt), inline: true });
    fields.push({ label: "Joined Server", value: formatDate(record.serverJoinedAt), inline: true });
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
    if (record.messageCount !== null && record.messageCount !== undefined) {
        fields.push({
            label: "Messages Sent",
            value: record.messageCount.toString(),
            inline: true,
        });
    }
    if (record.isBot) {
        fields.push({ label: "Bot", value: "Yes", inline: true });
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
let ProfileCommand = class ProfileCommand {
    async profile(member, showInChat, interaction) {
        const target = member ?? interaction.user;
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        try {
            let record = await Member.getByUserId(target.id);
            const avatarUrl = target.displayAvatarURL({
                extension: "png",
                size: 512,
                forceStatic: true,
            });
            if (avatarUrl) {
                const newAvatar = await downloadAvatar(avatarUrl);
                const baseRecord = record ??
                    {
                        userId: target.id,
                        isBot: target.bot ? 1 : 0,
                        username: target.username ?? null,
                        globalName: target.globalName ?? null,
                        avatarBlob: null,
                        serverJoinedAt: null,
                        lastSeenAt: null,
                        roleAdmin: 0,
                        roleModerator: 0,
                        roleRegular: 0,
                        roleMember: 0,
                        roleNewcomer: 0,
                        messageCount: null,
                    };
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
                await safeReply(interaction, {
                    content: `No profile data found for <@${target.id}>.`,
                    ephemeral,
                });
                return;
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
            await safeReply(interaction, {
                embeds: [embed],
                files: attachment ? [attachment] : undefined,
                ephemeral,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error loading profile: ${msg}`,
                ephemeral,
            });
        }
    }
};
__decorate([
    Slash({ description: "Show a member profile", name: "profile" }),
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
], ProfileCommand.prototype, "profile", null);
ProfileCommand = __decorate([
    Discord()
], ProfileCommand);
export { ProfileCommand };
