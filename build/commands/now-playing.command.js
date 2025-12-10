var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder, } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
function formatEntry(entry, guildId) {
    if (entry.threadId && guildId) {
        return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
    }
    return entry.title;
}
function chunkLines(lines, maxLength = 3800) {
    const chunks = [];
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
let NowPlayingCommand = class NowPlayingCommand {
    async nowPlaying(member, showAll, interaction) {
        const showAllFlag = showAll === true;
        const target = member ?? interaction.user;
        const ephemeral = !showAllFlag;
        await safeDeferReply(interaction, { ephemeral });
        if (showAllFlag) {
            await this.showEveryone(interaction, ephemeral);
            return;
        }
        await this.showSingle(interaction, target, ephemeral);
    }
    async showSingle(interaction, target, ephemeral) {
        const entries = await Member.getNowPlaying(target.id);
        if (!entries.length) {
            await safeReply(interaction, {
                content: `No Now Playing entries found for <@${target.id}>.`,
                ephemeral,
            });
            return;
        }
        const lines = entries.map((entry, idx) => `${idx + 1}. ${formatEntry(entry, interaction.guildId)}`);
        const footerText = target.tag || target.username || target.id;
        const embed = new EmbedBuilder()
            .setTitle("Now Playing")
            .setDescription(lines.join("\n"))
            .setFooter({ text: footerText });
        await safeReply(interaction, {
            content: `<@${target.id}>`,
            embeds: [embed],
            ephemeral,
        });
    }
    async showEveryone(interaction, ephemeral) {
        const lists = await Member.getAllNowPlaying();
        if (!lists.length) {
            await safeReply(interaction, {
                content: "No Now Playing data found for anyone yet.",
                ephemeral,
            });
            return;
        }
        const lines = lists.map((record, idx) => {
            const displayName = record.globalName ?? record.username ?? `Member ${idx + 1}`;
            const games = record.entries
                .map((entry) => formatEntry(entry, interaction.guildId))
                .join("; ");
            return `${idx + 1}. <@${record.userId}> (${displayName}) - ${games}`;
        });
        const chunks = chunkLines(lines);
        const embeds = chunks.slice(0, 10).map((chunk, idx) => new EmbedBuilder()
            .setTitle(idx === 0 ? "Now Playing - Everyone" : "Now Playing (continued)")
            .setDescription(chunk));
        const truncated = chunks.length > embeds.length;
        await safeReply(interaction, {
            content: truncated
                ? "Showing the first set of results (truncated to Discord embed limits)."
                : undefined,
            embeds,
            ephemeral,
        });
    }
};
__decorate([
    Slash({ description: "Show now playing data", name: "now-playing" }),
    __param(0, SlashOption({
        description: "Member to view; defaults to you.",
        name: "member",
        required: false,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "Show everyone with Now Playing entries.",
        name: "all",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], NowPlayingCommand.prototype, "nowPlaying", null);
NowPlayingCommand = __decorate([
    Discord()
], NowPlayingCommand);
export { NowPlayingCommand };
