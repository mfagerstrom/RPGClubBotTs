var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, } from "discord.js";
import { ButtonComponent, Discord, Slash } from "discordx";
import { buildAdminHelpResponse, isAdmin } from "./admin.command.js";
import { buildModHelpResponse, isModerator } from "./mod.command.js";
import { buildSuperAdminHelpResponse, isSuperAdmin } from "./superadmin.command.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
const HELP_TOPICS = [
    {
        id: "gotm",
        label: "/gotm",
        summary: "Search Game of the Month (GOTM) data (ephemeral by default).",
        syntax: "Syntax: /gotm [round:<integer>] [year:<integer>] [month:<string>] [title:<string>] [showinchat:<boolean>]",
        notes: "If round is provided, it takes precedence. year+month target a specific month. title searches by game title. Set showinchat:true to post publicly.",
    },
    {
        id: "nr-gotm",
        label: "/nr-gotm",
        summary: "Search Non-RPG Game of the Month (NR-GOTM) data (ephemeral by default).",
        syntax: "Syntax: /nr-gotm [round:<integer>] [year:<integer>] [month:<string>] [title:<string>] [showinchat:<boolean>]",
        notes: "If round is provided, it takes precedence. year+month target a specific month. title searches by game title. Set showinchat:true to post publicly.",
    },
    {
        id: "round",
        label: "/round",
        summary: "Show the current voting round, including GOTM and NR-GOTM winners (ephemeral by default).",
        syntax: "Syntax: /round [showinchat:<boolean>]",
        notes: "Set showinchat:true to post publicly.",
    },
    {
        id: "nextvote",
        label: "/nextvote",
        summary: "Show the date of the next GOTM/NR-GOTM vote and the discussion channels (ephemeral by default).",
        syntax: "Syntax: /nextvote [showinchat:<boolean>]",
        notes: "Set showinchat:true to post publicly.",
    },
    {
        id: "hltb",
        label: "/hltb",
        summary: "Search HowLongToBeat for game completion times (ephemeral by default).",
        syntax: "Syntax: /hltb title:<string> [showinchat:<boolean>]",
        parameters: "title (required string) - game title and optional descriptors. showinchat (optional boolean) - post publicly if true.",
    },
    {
        id: "coverart",
        label: "/coverart",
        summary: "Search for video game cover art using Google/HLTB data (ephemeral by default).",
        syntax: "Syntax: /coverart title:<string> [showinchat:<boolean>]",
        parameters: "title (required string) - game title and optional descriptors. showinchat (optional boolean) - post publicly if true.",
    },
    {
        id: "admin",
        label: "/admin",
        summary: "Admin-only commands for managing bot presence and GOTM/NR-GOTM data.",
        syntax: "Use /admin help for a detailed list of admin subcommands, their syntax, and parameters.",
    },
    {
        id: "mod",
        label: "/mod",
        summary: "Moderator commands for managing bot presence and NR-GOTM data.",
        syntax: "Use /mod help for a detailed list of moderator subcommands, their syntax, and parameters.",
    },
    {
        id: "superadmin",
        label: "/superadmin",
        summary: "Server owner commands for GOTM/NR-GOTM management and bot presence.",
        syntax: "Use /superadmin help for a detailed list of server owner subcommands, their syntax, and parameters.",
    },
];
function buildHelpButtons(activeId) {
    const rows = [];
    for (const chunk of chunkArray(HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    return rows;
}
function buildHelpDetailsEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.parameters) {
        embed.addFields({ name: "Parameters", value: topic.parameters });
    }
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
export function buildMainHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("RPG Club Bot Help")
        .setDescription("Choose a command button below to see its syntax and notes.");
    return {
        embeds: [embed],
        components: buildHelpButtons(activeTopicId),
    };
}
function chunkArray(items, chunkSize) {
    const chunks = [];
    let current = [];
    for (const item of items) {
        current.push(item);
        if (current.length === chunkSize) {
            chunks.push(current);
            current = [];
        }
    }
    if (current.length) {
        chunks.push(current);
    }
    return chunks;
}
let BotHelp = class BotHelp {
    async help(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const response = buildMainHelpResponse();
        await safeReply(interaction, {
            ...response,
            ephemeral: true,
        });
    }
    async handleHelpButton(interaction) {
        if (interaction.customId === "help-main") {
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        const topicId = interaction.customId.replace("help-", "");
        const topic = HELP_TOPICS.find((entry) => entry.id === topicId);
        if (topicId === "admin") {
            const ok = await isAdmin(interaction);
            if (!ok)
                return;
            const response = buildAdminHelpResponse();
            await safeUpdate(interaction, {
                ...response,
            });
            return;
        }
        if (topicId === "mod") {
            const ok = await isModerator(interaction);
            if (!ok)
                return;
            const response = buildModHelpResponse();
            await safeUpdate(interaction, {
                ...response,
            });
            return;
        }
        if (topicId === "superadmin") {
            const ok = await isSuperAdmin(interaction);
            if (!ok)
                return;
            const response = buildSuperAdminHelpResponse();
            await safeUpdate(interaction, {
                ...response,
            });
            return;
        }
        if (!topic) {
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that help topic. Showing the main help menu.",
            });
            return;
        }
        const helpEmbed = buildHelpDetailsEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [helpEmbed],
            components: buildHelpButtons(topic.id),
        });
    }
};
__decorate([
    Slash({ description: "Show help for all bot commands", name: "help" })
], BotHelp.prototype, "help", null);
__decorate([
    ButtonComponent({ id: /^help-.+/ })
], BotHelp.prototype, "handleHelpButton", null);
BotHelp = __decorate([
    Discord()
], BotHelp);
export { BotHelp };
