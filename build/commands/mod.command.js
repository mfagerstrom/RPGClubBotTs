var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionsBitField, } from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
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
    const rows = [];
    for (const chunk of chunkArray(MOD_HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`mod-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    return rows;
}
function extractModTopicId(customId) {
    const prefix = "mod-help-";
    const startIndex = customId.indexOf(prefix);
    if (startIndex === -1)
        return null;
    const raw = customId.slice(startIndex + prefix.length).trim();
    return (MOD_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null);
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
function chunkArray(items, chunkSize) {
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
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
        const topicId = extractModTopicId(interaction.customId);
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
    ButtonComponent({ id: /^mod-help-.+/ })
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
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary)));
    return {
        embeds: [embed],
        components,
    };
}
