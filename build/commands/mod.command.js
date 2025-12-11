var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, EmbedBuilder, MessageFlags, PermissionsBitField, StringSelectMenuBuilder, } from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
export const MOD_HELP_TOPICS = [
    {
        id: "presence",
        label: "/mod presence",
        summary: 'Set the bot\'s "Now Playing" text.',
        syntax: "Syntax: /mod presence text:<string>",
        parameters: "text (required string) - new presence text.",
    },
    {
        id: "presence-history",
        label: "/mod presence-history",
        summary: "Show the most recent presence changes.",
        syntax: "Syntax: /mod presence-history [count:<integer>]",
        parameters: "count (optional integer, default 5, max 50) - number of entries.",
    },
];
function buildModHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("mod-help-select")
        .setPlaceholder("/mod help")
        .addOptions(MOD_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
export function buildModHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.parameters) {
        embed.addFields({ name: "Parameters", value: topic.parameters });
    }
    return embed;
}
let Mod = class Mod {
    async presence(text, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isModerator(interaction);
        if (okToUseCommand) {
            await setPresence(interaction, text);
            await safeReply(interaction, {
                content: `I'm now playing: ${text}!`,
            });
        }
    }
    async presenceHistory(count, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isModerator(interaction);
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
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isModerator(interaction);
        if (!okToUseCommand) {
            return;
        }
        const response = buildModHelpResponse();
        await safeReply(interaction, {
            ...response,
            ephemeral: true,
        });
    }
    async handleModHelpButton(interaction) {
        const topicId = interaction.values?.[0];
        if (topicId === "help-main") {
            const { buildMainHelpResponse } = await import("./help.command.js");
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        const topic = topicId ? MOD_HELP_TOPICS.find((entry) => entry.id === topicId) : null;
        if (!topic) {
            const response = buildModHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that moderator help topic. Showing the moderator help menu.",
            });
            return;
        }
        const helpEmbed = buildModHelpEmbed(topic);
        const response = buildModHelpResponse(topic.id);
        await safeUpdate(interaction, {
            embeds: [helpEmbed],
            components: response.components,
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
], Mod.prototype, "presence", null);
__decorate([
    Slash({ description: "Show presence history", name: "presence-history" }),
    __param(0, SlashOption({
        description: "How many entries to show (default 5, max 50)",
        name: "count",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    }))
], Mod.prototype, "presenceHistory", null);
__decorate([
    Slash({ description: "Show help for moderator commands", name: "help" })
], Mod.prototype, "help", null);
__decorate([
    SelectMenuComponent({ id: "mod-help-select" })
], Mod.prototype, "handleModHelpButton", null);
Mod = __decorate([
    Discord(),
    SlashGroup({ description: "Moderator Commands", name: "mod" }),
    SlashGroup("mod")
], Mod);
export { Mod };
export async function isModerator(interaction) {
    const anyInteraction = interaction;
    const member = interaction.member;
    const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
    let isMod = canCheck
        ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
        : false;
    if (!isMod) {
        const isAdmin = canCheck
            ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
            : false;
        if (!isAdmin) {
            const denial = {
                content: "Access denied. Command requires Moderator role or above.",
                flags: MessageFlags.Ephemeral,
            };
            try {
                if (anyInteraction.replied || anyInteraction.deferred || anyInteraction.__rpgAcked) {
                    await interaction.followUp(denial);
                }
                else {
                    await interaction.reply(denial);
                    anyInteraction.__rpgAcked = true;
                    anyInteraction.__rpgDeferred = false;
                }
            }
            catch {
                // swallow
            }
        }
        else {
            isMod = true;
        }
    }
    return isMod;
}
export function buildModHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("Moderator Commands Help")
        .setDescription("Pick a `/mod` command to see what it does and how to run it.");
    const components = buildModHelpButtons(activeTopicId);
    return {
        embeds: [embed],
        components,
    };
}
