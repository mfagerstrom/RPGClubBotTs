var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder, PermissionsBitField } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let Admin = class Admin {
    async presence(text, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (okToUseCommand) {
            await setPresence(interaction, text);
            await safeReply(interaction, {
                content: `I'm now playing: ${text}!`
            });
        }
    }
    async presenceHistory(count, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const limit = typeof count === "number" && Number.isFinite(count)
            ? Math.max(1, Math.min(50, Math.trunc(count)))
            : 5;
        const entries = await getPresenceHistory(limit);
        if (!entries.length) {
            await safeReply(interaction, {
                content: "No presence history found.",
            });
            return;
        }
        const lines = entries.map((entry) => {
            const timestamp = entry.setAt instanceof Date ? entry.setAt.toLocaleString() : String(entry.setAt);
            const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
            return `• [${timestamp}] ${entry.activityName} (set by ${userDisplay})`;
        });
        const header = `Last ${entries.length} presence entr${entries.length === 1 ? "y" : "ies"}:\n`;
        await safeReply(interaction, {
            content: header + lines.join("\n"),
        });
    }
    async help(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle("Admin Commands Help")
            .setDescription("Available `/admin` subcommands")
            .addFields({
            name: "/admin presence",
            value: "Set the bot's \"Now Playing\" text.\n" +
                "**Syntax:** `/admin presence text:<string>`\n" +
                "**Parameters:** `text` (required string) - new presence text.",
        }, {
            name: "/admin presence-history",
            value: "Show the most recent presence changes.\n" +
                "**Syntax:** `/admin presence-history [count:<integer>]`\n" +
                "**Parameters:** `count` (optional integer, default 5, max 50) - number of entries.",
        }, {
            name: "/admin help",
            value: "Show this help information.\n" +
                "**Syntax:** `/admin help`",
        });
        await safeReply(interaction, {
            embeds: [embed],
        });
    }
};
__decorate([
    Slash({ description: "Set Presence", name: "presence" }),
    __param(0, SlashOption({
        description: "What should the 'Now Playing' value be?",
        name: "text",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "presence", null);
__decorate([
    Slash({ description: "Show presence history", name: "presence-history" }),
    __param(0, SlashOption({
        description: "How many entries to show (default 5, max 50)",
        name: "count",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    }))
], Admin.prototype, "presenceHistory", null);
__decorate([
    Slash({ description: "Show help for admin commands", name: "help" })
], Admin.prototype, "help", null);
Admin = __decorate([
    Discord(),
    SlashGroup({ description: "Admin Commands", name: "admin" }),
    SlashGroup("admin")
], Admin);
export { Admin };
export async function isAdmin(interaction) {
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
        await safeReply(interaction, {
            content: 'Access denied.  Command requires Administrator role.'
        });
    }
    return isAdmin;
}
