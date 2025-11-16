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
import { getPresenceHistory, setPresence, setPresenceFromInteraction, } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, { updateGotmGameFieldInDatabase, insertGotmRoundInDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, insertNrGotmRoundInDatabase, } from "../classes/NrGotm.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
const ADMIN_PRESENCE_CHOICES = new Map();
export const ADMIN_HELP_TOPICS = [
    {
        id: "presence",
        label: "/admin presence",
        summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
        syntax: "Syntax: /admin presence [text:<string>]",
        parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
    },
    {
        id: "add-gotm",
        label: "/admin add-gotm",
        summary: "Interactively add a new GOTM round.",
        syntax: "Syntax: /admin add-gotm",
        notes: "The round number is always assigned automatically as the next round after the current highest GOTM round.",
    },
    {
        id: "edit-gotm",
        label: "/admin edit-gotm",
        summary: "Interactively edit GOTM data for a given round.",
        syntax: "Syntax: /admin edit-gotm round:<integer>",
        parameters: "round (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
    },
    {
        id: "add-nr-gotm",
        label: "/admin add-nr-gotm",
        summary: "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round.",
        syntax: "Syntax: /admin add-nr-gotm",
        notes: "The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
    },
    {
        id: "edit-nr-gotm",
        label: "/admin edit-nr-gotm",
        summary: "Interactively edit NR-GOTM data for a given round.",
        syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
        parameters: "round (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
    },
    {
        id: "set-nextvote",
        label: "/admin set-nextvote",
        summary: "Set the date of the next GOTM/NR-GOTM vote.",
        syntax: "Syntax: /admin set-nextvote date:<date>",
        notes: "Votes are typically held the last Friday of the month.",
    },
];
function buildAdminHelpButtons(activeId) {
    const rows = [];
    for (const chunk of chunkArray(ADMIN_HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`admin-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    return rows;
}
function extractAdminTopicId(customId) {
    const prefix = "admin-help-";
    const startIndex = customId.indexOf(prefix);
    if (startIndex === -1)
        return null;
    const raw = customId.slice(startIndex + prefix.length).trim();
    return (ADMIN_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null);
}
export function buildAdminHelpEmbed(topic) {
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
function chunkArray(items, chunkSize) {
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}
export function buildAdminHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("Admin Commands Help")
        .setDescription("Choose an `/admin` subcommand button to view details.");
    const components = buildAdminHelpButtons(activeTopicId);
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary)));
    return {
        embeds: [embed],
        components,
    };
}
function buildPresenceHistoryEmbed(entries) {
    const descriptionLines = entries.map((entry, index) => {
        const timestamp = entry.setAt instanceof Date
            ? entry.setAt.toLocaleString()
            : entry.setAt
                ? String(entry.setAt)
                : "unknown date";
        const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
        return `${index + 1}. ${entry.activityName} — ${timestamp} (by ${userDisplay})`;
    });
    descriptionLines.push("");
    descriptionLines.push("Would you like to restore a previous presence?");
    return new EmbedBuilder()
        .setTitle("Presence History")
        .setDescription(descriptionLines.join("\n"));
}
function buildAdminPresenceButtons(count) {
    const buttons = [];
    for (let i = 0; i < count; i++) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`admin-presence-restore-${i}`)
            .setLabel(String(i + 1))
            .setStyle(ButtonStyle.Success));
    }
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("admin-presence-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger)));
    return rows;
}
async function showAdminPresenceHistory(interaction) {
    const limit = 5;
    const entries = await getPresenceHistory(limit);
    if (!entries.length) {
        await safeReply(interaction, {
            content: "No presence history found.",
            ephemeral: true,
        });
        return;
    }
    const embed = buildPresenceHistoryEmbed(entries);
    const components = buildAdminPresenceButtons(entries.length);
    await safeReply(interaction, {
        embeds: [embed],
        components,
        ephemeral: true,
    });
    try {
        const msg = (await interaction.fetchReply());
        if (msg?.id) {
            ADMIN_PRESENCE_CHOICES.set(msg.id, entries.map((e) => e.activityName ?? ""));
        }
    }
    catch {
        // ignore
    }
}
let Admin = class Admin {
    async presence(text, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        if (text && text.trim()) {
            await setPresence(interaction, text.trim());
            await safeReply(interaction, {
                content: `I'm now playing: ${text.trim()}!`,
                ephemeral: true,
            });
            return;
        }
        await showAdminPresenceHistory(interaction);
    }
    async handleAdminPresenceRestore(interaction) {
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand)
            return;
        const messageId = interaction.message?.id;
        const entries = messageId ? ADMIN_PRESENCE_CHOICES.get(messageId) : undefined;
        const idx = Number(interaction.customId.replace("admin-presence-restore-", ""));
        if (!entries || !Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
            await safeUpdate(interaction, {
                content: "Sorry, I couldn't find that presence entry. Please run `/admin presence` again.",
                components: [],
            });
            if (messageId)
                ADMIN_PRESENCE_CHOICES.delete(messageId);
            return;
        }
        const presenceText = entries[idx];
        try {
            await setPresenceFromInteraction(interaction, presenceText);
            await safeUpdate(interaction, {
                content: `Restored presence to: ${presenceText}`,
                components: [],
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeUpdate(interaction, {
                content: `Failed to restore presence: ${msg}`,
                components: [],
            });
        }
        finally {
            if (messageId)
                ADMIN_PRESENCE_CHOICES.delete(messageId);
        }
    }
    async handleAdminPresenceCancel(interaction) {
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand)
            return;
        const messageId = interaction.message?.id;
        if (messageId)
            ADMIN_PRESENCE_CHOICES.delete(messageId);
        await safeUpdate(interaction, {
            content: "No presence was restored.",
            components: [],
        });
    }
    async setNextVote(dateText, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const parsed = new Date(dateText);
        if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
            await safeReply(interaction, {
                content: "Invalid date format. Please use a recognizable date such as `YYYY-MM-DD`.",
                ephemeral: true,
            });
            return;
        }
        try {
            const current = await BotVotingInfo.getCurrentRound();
            if (!current) {
                await safeReply(interaction, {
                    content: "No voting round information is available. Create a round before setting the next vote date.",
                    ephemeral: true,
                });
                return;
            }
            await BotVotingInfo.updateNextVoteAt(current.roundNumber, parsed);
            await safeReply(interaction, {
                content: `Next vote date updated to ${parsed.toLocaleDateString()}.`,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error updating next vote date: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async addGotm(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        let allEntries;
        try {
            allEntries = Gotm.all();
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error loading existing GOTM data: ${msg}`,
            });
            return;
        }
        const nextRound = allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;
        await safeReply(interaction, {
            content: `Preparing to create GOTM round ${nextRound}.`,
        });
        const monthYearRaw = await promptUserForInput(interaction, `Enter the month/year label for round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`);
        if (monthYearRaw === null) {
            return;
        }
        const monthYear = monthYearRaw.trim();
        if (!monthYear) {
            await safeReply(interaction, {
                content: "Month/year label cannot be empty. Creation cancelled.",
            });
            return;
        }
        const gameCountRaw = await promptUserForInput(interaction, "How many games are in this GOTM round? (1-5). Type `cancel` to abort.");
        if (gameCountRaw === null) {
            return;
        }
        const gameCount = Number(gameCountRaw);
        if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
            await safeReply(interaction, {
                content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
            });
            return;
        }
        const games = [];
        for (let i = 0; i < gameCount; i++) {
            const n = i + 1;
            const titleRaw = await promptUserForInput(interaction, `Enter the title for game #${n}.`);
            if (titleRaw === null) {
                return;
            }
            const title = titleRaw.trim();
            if (!title) {
                await safeReply(interaction, {
                    content: "Game title cannot be empty. Creation cancelled.",
                });
                return;
            }
            const threadRaw = await promptUserForInput(interaction, `Enter the thread ID for game #${n} (or type \`none\` / \`null\` to leave blank).`);
            if (threadRaw === null) {
                return;
            }
            const threadTrimmed = threadRaw.trim();
            const threadId = threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;
            const redditRaw = await promptUserForInput(interaction, `Enter the Reddit URL for game #${n} (or type \`none\` / \`null\` to leave blank).`);
            if (redditRaw === null) {
                return;
            }
            const redditTrimmed = redditRaw.trim();
            const redditUrl = redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;
            games.push({
                title,
                threadId,
                redditUrl,
            });
        }
        try {
            await insertGotmRoundInDatabase(nextRound, monthYear, games);
            const newEntry = Gotm.addRound(nextRound, monthYear, games);
            const embed = await buildGotmEntryEmbed(newEntry, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `Created GOTM round ${nextRound}.`,
                embeds: [embed],
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to create GOTM round ${nextRound}: ${msg}`,
            });
        }
    }
    async addNrGotm(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        let allEntries;
        try {
            allEntries = NrGotm.all();
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error loading existing NR-GOTM data: ${msg}`,
            });
            return;
        }
        const nextRound = allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;
        await safeReply(interaction, {
            content: `Preparing to create NR-GOTM round ${nextRound}.`,
        });
        const monthYearRaw = await promptUserForInput(interaction, `Enter the month/year label for NR-GOTM round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`);
        if (monthYearRaw === null) {
            return;
        }
        const monthYear = monthYearRaw.trim();
        if (!monthYear) {
            await safeReply(interaction, {
                content: "Month/year label cannot be empty. Creation cancelled.",
            });
            return;
        }
        const gameCountRaw = await promptUserForInput(interaction, "How many games are in this NR-GOTM round? (1-5). Type `cancel` to abort.");
        if (gameCountRaw === null) {
            return;
        }
        const gameCount = Number(gameCountRaw);
        if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
            await safeReply(interaction, {
                content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
            });
            return;
        }
        const games = [];
        for (let i = 0; i < gameCount; i++) {
            const n = i + 1;
            const titleRaw = await promptUserForInput(interaction, `Enter the title for NR-GOTM game #${n}.`);
            if (titleRaw === null) {
                return;
            }
            const title = titleRaw.trim();
            if (!title) {
                await safeReply(interaction, {
                    content: "Game title cannot be empty. Creation cancelled.",
                });
                return;
            }
            const threadRaw = await promptUserForInput(interaction, `Enter the thread ID for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`);
            if (threadRaw === null) {
                return;
            }
            const threadTrimmed = threadRaw.trim();
            const threadId = threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;
            const redditRaw = await promptUserForInput(interaction, `Enter the Reddit URL for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`);
            if (redditRaw === null) {
                return;
            }
            const redditTrimmed = redditRaw.trim();
            const redditUrl = redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;
            games.push({
                title,
                threadId,
                redditUrl,
            });
        }
        try {
            await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
            const newEntry = NrGotm.addRound(nextRound, monthYear, games);
            const embed = await buildNrGotmEntryEmbed(newEntry, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `Created NR-GOTM round ${nextRound}.`,
                embeds: [embed],
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to create NR-GOTM round ${nextRound}: ${msg}`,
            });
        }
    }
    async editGotm(round, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const roundNumber = Number(round);
        if (!Number.isFinite(roundNumber)) {
            await safeReply(interaction, {
                content: "Invalid round number.",
            });
            return;
        }
        let entries;
        try {
            entries = Gotm.getByRound(roundNumber);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error loading GOTM data: ${msg}`,
            });
            return;
        }
        if (!entries.length) {
            await safeReply(interaction, {
                content: `No GOTM entry found for round ${roundNumber}.`,
            });
            return;
        }
        const entry = entries[0];
        const embed = await buildGotmEntryEmbed(entry, interaction.guildId ?? undefined, interaction.client);
        await safeReply(interaction, {
            content: `Editing GOTM round ${roundNumber}.`,
            embeds: [embed],
        });
        const totalGames = entry.gameOfTheMonth.length;
        let gameIndex = 0;
        if (totalGames > 1) {
            const gameAnswer = await promptUserForInput(interaction, `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`);
            if (gameAnswer === null) {
                return;
            }
            const idx = Number(gameAnswer);
            if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
                await safeReply(interaction, {
                    content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
                });
                return;
            }
            gameIndex = idx - 1;
        }
        const fieldAnswerRaw = await promptUserForInput(interaction, "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.");
        if (fieldAnswerRaw === null) {
            return;
        }
        const fieldAnswer = fieldAnswerRaw.toLowerCase();
        let field = null;
        let nullableField = false;
        if (fieldAnswer === "title") {
            field = "title";
        }
        else if (fieldAnswer === "thread") {
            field = "threadId";
            nullableField = true;
        }
        else if (fieldAnswer === "reddit") {
            field = "redditUrl";
            nullableField = true;
        }
        else {
            await safeReply(interaction, {
                content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
            });
            return;
        }
        const valuePrompt = nullableField
            ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
            : `Enter the new value for ${fieldAnswer}.`;
        const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
        if (valueAnswerRaw === null) {
            return;
        }
        const valueTrimmed = valueAnswerRaw.trim();
        let newValue = valueTrimmed;
        if (nullableField && /^none|null$/i.test(valueTrimmed)) {
            newValue = null;
        }
        try {
            await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field, newValue);
            let updatedEntry = null;
            if (field === "title") {
                updatedEntry = Gotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
            }
            else if (field === "threadId") {
                updatedEntry = Gotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "redditUrl") {
                updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
            }
            const entryToShow = updatedEntry ?? entry;
            const updatedEmbed = await buildGotmEntryEmbed(entryToShow, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `GOTM round ${roundNumber} updated successfully.`,
                embeds: [updatedEmbed],
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to update GOTM round ${roundNumber}: ${msg}`,
            });
        }
    }
    async editNrGotm(round, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const roundNumber = Number(round);
        if (!Number.isFinite(roundNumber)) {
            await safeReply(interaction, {
                content: "Invalid NR-GOTM round number.",
            });
            return;
        }
        let entries;
        try {
            entries = NrGotm.getByRound(roundNumber);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error loading NR-GOTM data: ${msg}`,
            });
            return;
        }
        if (!entries.length) {
            await safeReply(interaction, {
                content: `No NR-GOTM entry found for round ${roundNumber}.`,
            });
            return;
        }
        const entry = entries[0];
        const embed = await buildNrGotmEntryEmbed(entry, interaction.guildId ?? undefined, interaction.client);
        await safeReply(interaction, {
            content: `Editing NR-GOTM round ${roundNumber}.`,
            embeds: [embed],
        });
        const totalGames = entry.gameOfTheMonth.length;
        let gameIndex = 0;
        if (totalGames > 1) {
            const gameAnswer = await promptUserForInput(interaction, `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`);
            if (gameAnswer === null) {
                return;
            }
            const idx = Number(gameAnswer);
            if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
                await safeReply(interaction, {
                    content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
                });
                return;
            }
            gameIndex = idx - 1;
        }
        const fieldAnswerRaw = await promptUserForInput(interaction, "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.");
        if (fieldAnswerRaw === null) {
            return;
        }
        const fieldAnswer = fieldAnswerRaw.toLowerCase();
        let field = null;
        let nullableField = false;
        if (fieldAnswer === "title") {
            field = "title";
        }
        else if (fieldAnswer === "thread") {
            field = "threadId";
            nullableField = true;
        }
        else if (fieldAnswer === "reddit") {
            field = "redditUrl";
            nullableField = true;
        }
        else {
            await safeReply(interaction, {
                content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
            });
            return;
        }
        const valuePrompt = nullableField
            ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
            : `Enter the new value for ${fieldAnswer}.`;
        const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
        if (valueAnswerRaw === null) {
            return;
        }
        const valueTrimmed = valueAnswerRaw.trim();
        let newValue = valueTrimmed;
        if (nullableField && /^none|null$/i.test(valueTrimmed)) {
            newValue = null;
        }
        try {
            await updateNrGotmGameFieldInDatabase(roundNumber, gameIndex, field, newValue);
            let updatedEntry = null;
            if (field === "title") {
                updatedEntry = NrGotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
            }
            else if (field === "threadId") {
                updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "redditUrl") {
                updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
            }
            const entryToShow = updatedEntry ?? entry;
            const updatedEmbed = await buildNrGotmEntryEmbed(entryToShow, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `NR-GOTM round ${roundNumber} updated successfully.`,
                embeds: [updatedEmbed],
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to update NR-GOTM round ${roundNumber}: ${msg}`,
            });
        }
    }
    async help(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const response = buildAdminHelpResponse();
        await safeReply(interaction, {
            ...response,
            ephemeral: true,
        });
    }
    async handleAdminHelpButton(interaction) {
        const topicId = extractAdminTopicId(interaction.customId);
        const topic = topicId ? ADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;
        if (!topic) {
            const response = buildAdminHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that admin help topic. Showing the admin help menu.",
            });
            return;
        }
        const helpEmbed = buildAdminHelpEmbed(topic);
        const response = buildAdminHelpResponse(topic.id);
        await safeUpdate(interaction, {
            embeds: [helpEmbed],
            components: response.components,
        });
    }
};
__decorate([
    Slash({ description: "Set Presence", name: "presence" }),
    __param(0, SlashOption({
        description: "What should the 'Now Playing' value be? Leave empty to browse history.",
        name: "text",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "presence", null);
__decorate([
    ButtonComponent({ id: /^admin-presence-restore-\d+$/ })
], Admin.prototype, "handleAdminPresenceRestore", null);
__decorate([
    ButtonComponent({ id: "admin-presence-cancel" })
], Admin.prototype, "handleAdminPresenceCancel", null);
__decorate([
    Slash({
        description: "Votes are typically held the last Friday of the month",
        name: "set-nextvote",
    }),
    __param(0, SlashOption({
        description: "Next vote date. Votes are typically held the last Friday of the month.",
        name: "date",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "setNextVote", null);
__decorate([
    Slash({ description: "Add a new GOTM round", name: "add-gotm" })
], Admin.prototype, "addGotm", null);
__decorate([
    Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
], Admin.prototype, "addNrGotm", null);
__decorate([
    Slash({ description: "Edit GOTM data by round", name: "edit-gotm" }),
    __param(0, SlashOption({
        description: "Round number to edit",
        name: "round",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], Admin.prototype, "editGotm", null);
__decorate([
    Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" }),
    __param(0, SlashOption({
        description: "NR-GOTM Round number to edit",
        name: "round",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], Admin.prototype, "editNrGotm", null);
__decorate([
    Slash({ description: "Show help for admin commands", name: "help" })
], Admin.prototype, "help", null);
__decorate([
    ButtonComponent({ id: /^admin-help-.+/ })
], Admin.prototype, "handleAdminHelpButton", null);
Admin = __decorate([
    Discord(),
    SlashGroup({ description: "Admin Commands", name: "admin" }),
    SlashGroup("admin")
], Admin);
export { Admin };
async function promptUserForInput(interaction, question, timeoutMs = 120_000) {
    const channel = interaction.channel;
    const userId = interaction.user.id;
    if (!channel || typeof channel.awaitMessages !== "function") {
        await safeReply(interaction, {
            content: "Cannot prompt for additional input; this command must be used in a text channel.",
        });
        return null;
    }
    try {
        await safeReply(interaction, {
            content: `<@${userId}> ${question}`,
        });
    }
    catch (err) {
        console.error("Failed to send prompt message:", err);
    }
    try {
        const collected = await channel.awaitMessages({
            filter: (m) => m.author?.id === userId,
            max: 1,
            time: timeoutMs,
        });
        const first = collected?.first?.();
        if (!first) {
            await safeReply(interaction, {
                content: "Timed out waiting for a response. Edit cancelled.",
            });
            return null;
        }
        const content = (first.content ?? "").trim();
        if (!content) {
            await safeReply(interaction, {
                content: "Empty response received. Edit cancelled.",
            });
            return null;
        }
        if (/^cancel$/i.test(content)) {
            await safeReply(interaction, {
                content: "Edit cancelled.",
            });
            return null;
        }
        return content;
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        try {
            await safeReply(interaction, {
                content: `Error while waiting for a response: ${msg}`,
            });
        }
        catch {
            // ignore
        }
        return null;
    }
}
function formatGotmEntryForEdit(entry) {
    const lines = [];
    lines.push(`Round ${entry.round} - ${entry.monthYear}`);
    if (!entry.gameOfTheMonth.length) {
        lines.push("  (no games listed)");
        return lines.join("\n");
    }
    entry.gameOfTheMonth.forEach((game, index) => {
        const num = index + 1;
        lines.push(`${num}) Title: ${game.title}`);
        lines.push(`   Thread: ${game.threadId ?? "(none)"}`);
        lines.push(`   Reddit: ${game.redditUrl ?? "(none)"}`);
    });
    return lines.join("\n");
}
export async function isAdmin(interaction) {
    const anyInteraction = interaction;
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
        const denial = {
            content: "Access denied. Command requires Administrator role.",
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
        catch (err) {
            // swallow to avoid leaking
        }
    }
    return isAdmin;
}
