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
        summary: "GOTM commands: search history, list nominations (public), nominate or delete your own nomination (ephemeral).",
        syntax: "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /gotm noms | /gotm nominate title:<string> | /gotm delete-nomination",
        notes: "Search: round takes precedence; year+month target a specific month; title searches by game title; set showinchat:true to post publicly. Noms is public. Nominations target the upcoming round (current round + 1) and close one day before the vote.",
    },
    {
        id: "nr-gotm",
        label: "/nr-gotm",
        summary: "NR-GOTM commands: search history, list nominations (public), nominate or delete your own nomination (ephemeral).",
        syntax: "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /nr-gotm noms | /nr-gotm nominate title:<string> | /nr-gotm delete-nomination",
        notes: "Search: round takes precedence; year+month target a specific month; title searches by game title; set showinchat:true to post publicly. Noms is public. Nominations target the upcoming round (current round + 1) and close one day before the vote.",
    },
    {
        id: "noms",
        label: "/noms",
        summary: "Show both GOTM and NR-GOTM current nominations (public).",
        syntax: "Syntax: /noms",
        notes: "Lists the upcoming round nominations for GOTM and NR-GOTM together.",
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
        summary: "Show the date of the next GOTM/NR-GOTM vote (ephemeral by default).",
        syntax: "Syntax: /nextvote [showinchat:<boolean>]",
        notes: "Set showinchat:true to post publicly. See nominations with /noms; nominate via /gotm nominate or /nr-gotm nominate.",
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
        id: "remindme",
        label: "/remindme",
        summary: "Personal reminders with quick snooze buttons (DM delivery).",
        syntax: "Syntax: /remindme create when:<date/time> [note:<text>] | /remindme menu | /remindme snooze id:<int> until:<date/time> | /remindme delete id:<int>",
        notes: "Use natural inputs like 'in 45m' or absolute datetimes. Menu shows your reminders and ids.",
    },
    {
        id: "profile",
        label: "/profile",
        summary: "Show a member profile from stored RPG_CLUB_USERS data (ephemeral by default).",
        syntax: "Syntax: /profile [member:<user>] [showinchat:<boolean>]",
        notes: "Omit member to view your own profile. Use showinchat:true to post publicly.",
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
const GOTM_HELP_TOPICS = [
    {
        id: "search",
        label: "/gotm search",
        summary: "Search GOTM history by round, year/month, title, or default to current round.",
        syntax: "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
        notes: "Ephemeral by default; set showinchat:true to post publicly.",
    },
    {
        id: "noms",
        label: "/gotm noms",
        summary: "Public list of current GOTM nominations for the upcoming round.",
        syntax: "Syntax: /gotm noms",
    },
    {
        id: "nominate",
        label: "/gotm nominate",
        summary: "Submit or update your GOTM nomination for the upcoming round.",
        syntax: "Syntax: /gotm nominate title:<string>",
        notes: "Ephemeral feedback; changes are announced publicly with the refreshed list.",
    },
    {
        id: "delete-nomination",
        label: "/gotm delete-nomination",
        summary: "Delete your own GOTM nomination for the upcoming round.",
        syntax: "Syntax: /gotm delete-nomination",
        notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
    },
];
function buildGotmHelpButtons(activeId) {
    const rows = [];
    for (const chunk of chunkArray(GOTM_HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`gotm-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary)));
    return rows;
}
function buildGotmHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
const NR_GOTM_HELP_TOPICS = [
    {
        id: "search",
        label: "/nr-gotm search",
        summary: "Search NR-GOTM history by round, year/month, title, or default to current round.",
        syntax: "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
        notes: "Ephemeral by default; set showinchat:true to post publicly.",
    },
    {
        id: "noms",
        label: "/nr-gotm noms",
        summary: "Public list of current NR-GOTM nominations for the upcoming round.",
        syntax: "Syntax: /nr-gotm noms",
    },
    {
        id: "nominate",
        label: "/nr-gotm nominate",
        summary: "Submit or update your NR-GOTM nomination for the upcoming round.",
        syntax: "Syntax: /nr-gotm nominate title:<string>",
        notes: "Ephemeral feedback; changes are announced publicly with the refreshed list.",
    },
    {
        id: "delete-nomination",
        label: "/nr-gotm delete-nomination",
        summary: "Delete your own NR-GOTM nomination for the upcoming round.",
        syntax: "Syntax: /nr-gotm delete-nomination",
        notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
    },
];
function buildNrGotmHelpButtons(activeId) {
    const rows = [];
    for (const chunk of chunkArray(NR_GOTM_HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`nr-gotm-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary)));
    return rows;
}
function buildNrGotmHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
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
export function buildGotmHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/gotm commands")
        .setDescription("Choose a GOTM subcommand button to view details.");
    const components = buildGotmHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildNrGotmHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/nr-gotm commands")
        .setDescription("Choose an NR-GOTM subcommand button to view details.");
    const components = buildNrGotmHelpButtons(activeTopicId);
    return { embeds: [embed], components };
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
        if (topicId === "gotm") {
            const response = buildGotmHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        if (topicId === "nr-gotm") {
            const response = buildNrGotmHelpResponse();
            await safeUpdate(interaction, response);
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
    async handleGotmHelpButton(interaction) {
        const topicId = interaction.customId.replace("gotm-help-", "");
        const topic = GOTM_HELP_TOPICS.find((entry) => entry.id === topicId);
        if (!topic) {
            const response = buildGotmHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that GOTM help topic. Showing the GOTM help menu.",
            });
            return;
        }
        const embed = buildGotmHelpEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [embed],
            components: buildGotmHelpButtons(topic.id),
        });
    }
    async handleNrGotmHelpButton(interaction) {
        const topicId = interaction.customId.replace("nr-gotm-help-", "");
        const topic = NR_GOTM_HELP_TOPICS.find((entry) => entry.id === topicId);
        if (!topic) {
            const response = buildNrGotmHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that NR-GOTM help topic. Showing the NR-GOTM help menu.",
            });
            return;
        }
        const embed = buildNrGotmHelpEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [embed],
            components: buildNrGotmHelpButtons(topic.id),
        });
    }
};
__decorate([
    Slash({ description: "Show help for all bot commands", name: "help" })
], BotHelp.prototype, "help", null);
__decorate([
    ButtonComponent({ id: /^help-.+/ })
], BotHelp.prototype, "handleHelpButton", null);
__decorate([
    ButtonComponent({ id: /^gotm-help-.+/ })
], BotHelp.prototype, "handleGotmHelpButton", null);
__decorate([
    ButtonComponent({ id: /^nr-gotm-help-.+/ })
], BotHelp.prototype, "handleNrGotmHelpButton", null);
BotHelp = __decorate([
    Discord()
], BotHelp);
export { BotHelp };
