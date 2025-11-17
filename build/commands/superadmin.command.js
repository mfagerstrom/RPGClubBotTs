var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, } from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence, setPresenceFromInteraction, } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, { updateGotmGameFieldInDatabase, insertGotmRoundInDatabase, deleteGotmRoundFromDatabase, updateGotmVotingResultsInDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, insertNrGotmRoundInDatabase, deleteNrGotmRoundFromDatabase, updateNrGotmVotingResultsInDatabase, } from "../classes/NrGotm.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
const SUPERADMIN_PRESENCE_CHOICES = new Map();
export const SUPERADMIN_HELP_TOPICS = [
    {
        id: "presence",
        label: "/superadmin presence",
        summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
        syntax: "Syntax: /superadmin presence [text:<string>]",
        parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
    },
    {
        id: "add-gotm",
        label: "/superadmin add-gotm",
        summary: "Interactively add a new GOTM round.",
        syntax: "Syntax: /superadmin add-gotm",
        notes: "The round number is always assigned automatically as the next round after the current highest GOTM round.",
    },
    {
        id: "edit-gotm",
        label: "/superadmin edit-gotm",
        summary: "Interactively edit GOTM data for a given round.",
        syntax: "Syntax: /superadmin edit-gotm round:<integer>",
        parameters: "round (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
    },
    {
        id: "delete-gotm",
        label: "/superadmin delete-gotm",
        summary: "Delete the most recent GOTM round.",
        syntax: "Syntax: /superadmin delete-gotm",
        notes: "This removes the latest GOTM round from the database. Use this if a round was added too early or by mistake.",
    },
    {
        id: "add-nr-gotm",
        label: "/superadmin add-nr-gotm",
        summary: "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round.",
        syntax: "Syntax: /superadmin add-nr-gotm",
        notes: "The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
    },
    {
        id: "edit-nr-gotm",
        label: "/superadmin edit-nr-gotm",
        summary: "Interactively edit NR-GOTM data for a given round.",
        syntax: "Syntax: /superadmin edit-nr-gotm round:<integer>",
        parameters: "round (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
    },
    {
        id: "delete-nr-gotm",
        label: "/superadmin delete-nr-gotm",
        summary: "Delete the most recent NR-GOTM round.",
        syntax: "Syntax: /superadmin delete-nr-gotm",
        notes: "This removes the latest NR-GOTM round from the database. Use this if a round was added too early or by mistake.",
    },
    {
        id: "set-nextvote",
        label: "/superadmin set-nextvote",
        summary: "Set the date of the next GOTM/NR-GOTM vote.",
        syntax: "Syntax: /superadmin set-nextvote date:<date>",
        notes: "Votes are typically held the last Friday of the month.",
    },
    {
        id: "gotm-data-audit",
        label: "/superadmin gotm-data-audit",
        summary: "Audit GOTM data for missing thread IDs, Reddit URLs, and voting result IDs.",
        syntax: "Syntax: /superadmin gotm-data-audit [threadid:<boolean>] [redditurl:<boolean>] [votingresults:<boolean>]",
        notes: "By default all checks run. Provide specific flags to limit prompts. You can stop or skip prompts during the audit.",
    },
    {
        id: "nr-gotm-data-audit",
        label: "/superadmin nr-gotm-data-audit",
        summary: "Audit NR-GOTM data for missing thread IDs, Reddit URLs, and voting result IDs.",
        syntax: "Syntax: /superadmin nr-gotm-data-audit [threadid:<boolean>] [redditurl:<boolean>] [votingresults:<boolean>]",
        notes: "By default all checks run. Provide specific flags to limit prompts. You can stop or skip prompts during the audit.",
    },
];
function buildSuperAdminHelpButtons(activeId) {
    const rows = [];
    for (const chunk of chunkArray(SUPERADMIN_HELP_TOPICS, 5)) {
        rows.push(new ActionRowBuilder().addComponents(chunk.map((topic) => new ButtonBuilder()
            .setCustomId(`superadmin-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary))));
    }
    return rows;
}
function extractSuperAdminTopicId(customId) {
    const prefix = "superadmin-help-";
    const startIndex = customId.indexOf(prefix);
    if (startIndex === -1)
        return null;
    const raw = customId.slice(startIndex + prefix.length).trim();
    return (SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null);
}
export function buildSuperAdminHelpEmbed(topic) {
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
async function showSuperAdminPresenceHistory(interaction) {
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
    const components = buildSuperAdminPresenceButtons(entries.length);
    await safeReply(interaction, {
        embeds: [embed],
        components,
        ephemeral: true,
    });
    try {
        const msg = (await interaction.fetchReply());
        if (msg?.id) {
            SUPERADMIN_PRESENCE_CHOICES.set(msg.id, entries.map((e) => e.activityName ?? ""));
        }
    }
    catch {
        // ignore
    }
}
export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";
const THREAD_ID_MAX_LENGTH = 50;
function isAuditNoValue(value) {
    return value === AUDIT_NO_VALUE_SENTINEL;
}
function isAuditFieldMissing(value) {
    return !value && !isAuditNoValue(value);
}
function displayAuditValue(value) {
    if (isAuditNoValue(value))
        return null;
    return value ?? null;
}
const MONTHS_LOWER = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
function isAfterRedditCutoff(monthYear) {
    const match = monthYear?.match(/([A-Za-z]+)\s+(\d{4})/);
    if (!match)
        return false;
    const monthName = match[1]?.toLowerCase() ?? "";
    const year = Number(match[2]);
    const monthIndex = MONTHS_LOWER.indexOf(monthName);
    if (!Number.isFinite(year) || monthIndex === -1)
        return false;
    if (year > 2021)
        return true;
    if (year < 2021)
        return false;
    return monthIndex > 4; // after May 2021
}
function buildAuditPromptEmbed(info) {
    const lines = [];
    lines.push(info.roundLabel);
    lines.push("");
    lines.push("Current round data:");
    lines.push("```json");
    try {
        if (info.gameIndex !== null && Array.isArray(info.rawEntry?.gameOfTheMonth)) {
            const game = info.rawEntry.gameOfTheMonth[info.gameIndex];
            lines.push(JSON.stringify(game ?? info.rawEntry, null, 2));
        }
        else {
            lines.push(JSON.stringify(info.rawEntry, null, 2));
        }
    }
    catch {
        lines.push("(unable to render data)");
    }
    lines.push("```");
    lines.push("");
    if (info.field === "threadId") {
        lines.push("**Missing thread ID**. Provide a webhook/thread/channel ID for this game's discussion.");
    }
    else if (info.field === "redditUrl") {
        lines.push("**Missing Reddit URL**. Provide a link to the Reddit thread for this game.");
    }
    else {
        lines.push("**Missing voting results message ID**. Provide the message ID that contains voting results.");
    }
    lines.push("");
    lines.push("Click Skip to leave it empty, Stop Audit to end, No Value to skip forever, or type a value (none/null to clear).");
    lines.push("");
    lines.push("Provide the new value below:");
    return new EmbedBuilder()
        .setTitle(`${info.auditLabel} Data Audit`)
        .setDescription(lines.join("\n"));
}
async function promptForAuditValue(interaction, opts) {
    const promptEmbed = buildAuditPromptEmbed({
        auditLabel: opts.auditLabel,
        roundLabel: opts.roundLabel,
        gameTitle: opts.gameTitle,
        field: opts.field,
        winners: opts.winners,
        rawEntry: opts.rawEntry,
        gameIndex: opts.gameIndex,
    });
    const token = `${opts.tokenPrefix}-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const stopPrefix = `${opts.tokenPrefix}-audit-stop`;
    const skipPrefix = `${opts.tokenPrefix}-audit-skip`;
    const noValuePrefix = `${opts.tokenPrefix}-audit-novalue`;
    const buttonRow = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(`${stopPrefix}-${token}`)
        .setLabel("Stop Audit")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`${noValuePrefix}-${token}`)
        .setLabel("No Value")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(`${skipPrefix}-${token}`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Danger));
    let promptMessage = opts.promptMessage ?? null;
    const payload = {
        embeds: [promptEmbed],
        components: [buttonRow],
        content: undefined,
    };
    const editPrompt = async (msg, data) => {
        try {
            return await msg.edit(data);
        }
        catch (err) {
            if (err?.code === 10008) {
                return null;
            }
            throw err;
        }
    };
    const tryEditReply = async () => {
        try {
            const edited = await interaction.editReply(payload);
            return edited;
        }
        catch (err) {
            if (err?.code === 10008)
                return null;
            throw err;
        }
    };
    if (opts.useEditReply) {
        promptMessage = await tryEditReply();
    }
    else if (promptMessage) {
        const edited = await editPrompt(promptMessage, payload);
        promptMessage = edited ?? null;
    }
    if (!promptMessage) {
        // Fallback: create a new followup
        promptMessage = await interaction.followUp({
            ...payload,
            ephemeral: true,
        });
    }
    const buttonPromise = promptMessage
        .awaitMessageComponent({
        filter: (i) => {
            const cid = i.customId ?? "";
            return i.user?.id === interaction.user.id && cid.endsWith(token);
        },
        time: 120_000,
    })
        .then(async (i) => {
        const cid = i.customId ?? "";
        if (!i.deferred && !i.replied) {
            await i.deferUpdate().catch(() => { });
        }
        if (cid.startsWith(stopPrefix))
            return "stop";
        if (cid.startsWith(noValuePrefix))
            return { action: "no-value" };
        return { action: "skip" };
    })
        .catch(() => null);
    const channel = interaction.channel;
    const textPromise = channel?.awaitMessages
        ? channel
            .awaitMessages({
            filter: (m) => m.author?.id === interaction.user.id,
            max: 1,
            time: 120_000,
        })
            .then(async (collected) => {
            const first = collected?.first?.();
            const content = first?.content;
            if (!content)
                return null;
            const trimmed = String(content).trim();
            const lower = trimmed.toLowerCase();
            try {
                await first.delete().catch(() => { });
            }
            catch {
                // ignore delete failures
            }
            if (lower === "stop")
                return "stop";
            if (lower === "none" || lower === "null" || lower === "skip")
                return { action: "skip" };
            if (lower === "never" || lower === "no value" || lower === "no-value") {
                return { action: "no-value" };
            }
            return { action: "value", value: trimmed };
        })
            .catch(() => null)
        : Promise.resolve(null);
    const result = await Promise.race([buttonPromise, textPromise]);
    if (opts.useEditReply && promptMessage) {
        await interaction.editReply({ components: [] });
    }
    else {
        await editPrompt(promptMessage, { components: [] });
    }
    return {
        result: result ?? { action: "skip" },
        promptMessage,
    };
}
let SuperAdmin = class SuperAdmin {
    async presence(text, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        if (text && text.trim()) {
            await setPresence(interaction, text.trim());
            await safeReply(interaction, {
                content: `I'm now playing: ${text.trim()}!`,
                ephemeral: true,
            });
            return;
        }
        await showSuperAdminPresenceHistory(interaction);
    }
    async handleSuperAdminPresenceRestore(interaction) {
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const messageId = interaction.message?.id;
        const entries = messageId ? SUPERADMIN_PRESENCE_CHOICES.get(messageId) : undefined;
        const idx = Number(interaction.customId.replace("superadmin-presence-restore-", ""));
        if (!entries || !Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
            await safeUpdate(interaction, {
                content: "Sorry, I couldn't find that presence entry. Please run `/superadmin presence` again.",
                components: [],
            });
            if (messageId)
                SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
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
                SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
        }
    }
    async handleSuperAdminPresenceCancel(interaction) {
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const messageId = interaction.message?.id;
        if (messageId)
            SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
        await safeUpdate(interaction, {
            content: "No presence was restored.",
            components: [],
        });
    }
    async handleAuditButtons(interaction) {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate().catch(() => { });
        }
    }
    async gotmDataAudit(threadIdFlag, redditUrlFlag, votingResultsFlag, order, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const checks = {
            threadId: Boolean(threadIdFlag),
            redditUrl: Boolean(redditUrlFlag),
            votingResults: Boolean(votingResultsFlag),
        };
        if (!checks.threadId && !checks.redditUrl && !checks.votingResults) {
            checks.threadId = true;
            checks.redditUrl = true;
            checks.votingResults = true;
        }
        const dir = (order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
        const entries = Gotm.all()
            .slice()
            .sort((a, b) => (dir === "asc" ? a.round - b.round : b.round - a.round));
        if (!entries.length) {
            await safeReply(interaction, {
                content: "No GOTM data available to audit.",
                ephemeral,
            });
            return;
        }
        await safeReply(interaction, {
            content: "Starting GOTM data audit. Click Stop Audit at any prompt to end early. Click Skip or type none/null to leave a field empty.",
            ephemeral,
        });
        let stopped = false;
        let promptMessage = null;
        let useEditReply = false;
        try {
            promptMessage = (await interaction.fetchReply());
            useEditReply = !!promptMessage;
        }
        catch {
            // ignore fetch failures; prompt creation handled below
        }
        for (const entry of entries) {
            if (stopped)
                break;
            const roundLabel = `Round ${entry.round} (${entry.monthYear})`;
            const skipRedditAudit = isAfterRedditCutoff(entry.monthYear);
            for (let i = 0; i < entry.gameOfTheMonth.length; i++) {
                const game = entry.gameOfTheMonth[i];
                const winners = entry.gameOfTheMonth.map((g) => g.title);
                if (checks.threadId && isAuditFieldMissing(game.threadId)) {
                    const res = await promptForAuditValue(interaction, {
                        auditLabel: "GOTM",
                        tokenPrefix: "gotm",
                        round: entry.round,
                        roundLabel,
                        gameIndex: i,
                        gameTitle: game.title,
                        field: "threadId",
                        winners,
                        rawEntry: entry,
                        promptMessage,
                        useEditReply,
                    });
                    promptMessage = res.promptMessage;
                    if (res.result === "stop") {
                        stopped = true;
                        break;
                    }
                    if (res.result && res.result.action === "value") {
                        const val = res.result.value ?? "";
                        if (val.length > THREAD_ID_MAX_LENGTH) {
                            await safeReply(interaction, {
                                content: `Thread ID is too long (${val.length}). Max allowed is ${THREAD_ID_MAX_LENGTH}. Please provide the ID (not a URL).`,
                            });
                            continue;
                        }
                        await updateGotmGameFieldInDatabase(entry.round, i, "threadId", res.result.value);
                        Gotm.updateThreadIdByRound(entry.round, res.result.value, i);
                    }
                    else if (res.result && res.result.action === "no-value") {
                        await updateGotmGameFieldInDatabase(entry.round, i, "threadId", AUDIT_NO_VALUE_SENTINEL);
                        Gotm.updateThreadIdByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
                    }
                }
                if (stopped)
                    break;
                if (checks.redditUrl && !skipRedditAudit && isAuditFieldMissing(game.redditUrl)) {
                    const res = await promptForAuditValue(interaction, {
                        auditLabel: "GOTM",
                        tokenPrefix: "gotm",
                        round: entry.round,
                        roundLabel,
                        gameIndex: i,
                        gameTitle: game.title,
                        field: "redditUrl",
                        winners,
                        rawEntry: entry,
                        promptMessage,
                        useEditReply,
                    });
                    promptMessage = res.promptMessage;
                    if (res.result === "stop") {
                        stopped = true;
                        break;
                    }
                    if (res.result && res.result.action === "value") {
                        await updateGotmGameFieldInDatabase(entry.round, i, "redditUrl", res.result.value);
                        Gotm.updateRedditUrlByRound(entry.round, res.result.value, i);
                    }
                    else if (res.result && res.result.action === "no-value") {
                        await updateGotmGameFieldInDatabase(entry.round, i, "redditUrl", AUDIT_NO_VALUE_SENTINEL);
                        Gotm.updateRedditUrlByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
                    }
                }
            }
            if (stopped)
                break;
            if (checks.votingResults && isAuditFieldMissing(entry.votingResultsMessageId)) {
                const res = await promptForAuditValue(interaction, {
                    auditLabel: "GOTM",
                    tokenPrefix: "gotm",
                    round: entry.round,
                    roundLabel,
                    gameIndex: null,
                    gameTitle: null,
                    field: "votingResults",
                    winners: entry.gameOfTheMonth.map((g) => g.title),
                    rawEntry: entry,
                    promptMessage,
                    useEditReply,
                });
                promptMessage = res.promptMessage;
                if (res.result === "stop") {
                    stopped = true;
                    break;
                }
                if (res.result && res.result.action === "value") {
                    await updateGotmVotingResultsInDatabase(entry.round, res.result.value);
                    Gotm.updateVotingResultsByRound(entry.round, res.result.value);
                }
                else if (res.result && res.result.action === "no-value") {
                    await updateGotmVotingResultsInDatabase(entry.round, AUDIT_NO_VALUE_SENTINEL);
                    Gotm.updateVotingResultsByRound(entry.round, AUDIT_NO_VALUE_SENTINEL);
                }
            }
        }
        if (promptMessage) {
            const finalContent = stopped ? "Audit stopped." : "Audit completed.";
            try {
                if (interaction.editReply && promptMessage && promptMessage.id === (await interaction.fetchReply().catch(() => null))?.id) {
                    await interaction.editReply({ content: finalContent, embeds: [], components: [] });
                }
                else {
                    await promptMessage.edit({ content: finalContent, embeds: [], components: [] });
                }
            }
            catch (err) {
                if (err?.code !== 10008)
                    throw err;
                await safeReply(interaction, { content: finalContent });
            }
        }
        else {
            if (stopped) {
                await safeReply(interaction, { content: "Audit stopped." });
            }
            else {
                await safeReply(interaction, { content: "Audit completed." });
            }
        }
    }
    async nrGotmDataAudit(threadIdFlag, redditUrlFlag, votingResultsFlag, order, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const checks = {
            threadId: Boolean(threadIdFlag),
            redditUrl: Boolean(redditUrlFlag),
            votingResults: Boolean(votingResultsFlag),
        };
        if (!checks.threadId && !checks.redditUrl && !checks.votingResults) {
            checks.threadId = true;
            checks.redditUrl = true;
            checks.votingResults = true;
        }
        const dir = (order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
        const entries = NrGotm.all()
            .slice()
            .sort((a, b) => (dir === "asc" ? a.round - b.round : b.round - a.round));
        if (!entries.length) {
            await safeReply(interaction, {
                content: "No NR-GOTM data available to audit.",
            });
            return;
        }
        await safeReply(interaction, {
            content: "Starting NR-GOTM data audit. Click Stop Audit at any prompt to end early. Click Skip or type none/null to leave a field empty.",
        });
        let stopped = false;
        let promptMessage = null;
        let useEditReply = false;
        try {
            promptMessage = (await interaction.fetchReply());
            useEditReply = !!promptMessage;
        }
        catch {
            // ignore
        }
        for (const entry of entries) {
            if (stopped)
                break;
            const roundLabel = `Round ${entry.round} (${entry.monthYear})`;
            const skipRedditAudit = isAfterRedditCutoff(entry.monthYear);
            for (let i = 0; i < entry.gameOfTheMonth.length; i++) {
                const game = entry.gameOfTheMonth[i];
                const winners = entry.gameOfTheMonth.map((g) => g.title);
                if (checks.threadId && isAuditFieldMissing(game.threadId)) {
                    const res = await promptForAuditValue(interaction, {
                        auditLabel: "NR-GOTM",
                        tokenPrefix: "nr-gotm",
                        round: entry.round,
                        roundLabel,
                        gameIndex: i,
                        gameTitle: game.title,
                        field: "threadId",
                        winners,
                        rawEntry: entry,
                        promptMessage,
                        useEditReply,
                    });
                    promptMessage = res.promptMessage;
                    if (res.result === "stop") {
                        stopped = true;
                        break;
                    }
                    if (res.result && res.result.action === "value") {
                        const val = res.result.value ?? "";
                        if (val.length > THREAD_ID_MAX_LENGTH) {
                            await safeReply(interaction, {
                                content: `Thread ID is too long (${val.length}). Max allowed is ${THREAD_ID_MAX_LENGTH}. Please provide the ID (not a URL).`,
                            });
                            continue;
                        }
                        await updateNrGotmGameFieldInDatabase(entry.round, i, "threadId", res.result.value);
                        NrGotm.updateThreadIdByRound(entry.round, res.result.value, i);
                    }
                    else if (res.result && res.result.action === "no-value") {
                        await updateNrGotmGameFieldInDatabase(entry.round, i, "threadId", AUDIT_NO_VALUE_SENTINEL);
                        NrGotm.updateThreadIdByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
                    }
                }
                if (stopped)
                    break;
                if (checks.redditUrl && !skipRedditAudit && isAuditFieldMissing(game.redditUrl)) {
                    const res = await promptForAuditValue(interaction, {
                        auditLabel: "NR-GOTM",
                        tokenPrefix: "nr-gotm",
                        round: entry.round,
                        roundLabel,
                        gameIndex: i,
                        gameTitle: game.title,
                        field: "redditUrl",
                        winners,
                        rawEntry: entry,
                        promptMessage,
                        useEditReply,
                    });
                    promptMessage = res.promptMessage;
                    if (res.result === "stop") {
                        stopped = true;
                        break;
                    }
                    if (res.result && res.result.action === "value") {
                        await updateNrGotmGameFieldInDatabase(entry.round, i, "redditUrl", res.result.value);
                        NrGotm.updateRedditUrlByRound(entry.round, res.result.value, i);
                    }
                    else if (res.result && res.result.action === "no-value") {
                        await updateNrGotmGameFieldInDatabase(entry.round, i, "redditUrl", AUDIT_NO_VALUE_SENTINEL);
                        NrGotm.updateRedditUrlByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
                    }
                }
            }
            if (stopped)
                break;
            if (checks.votingResults && isAuditFieldMissing(entry.votingResultsMessageId)) {
                const res = await promptForAuditValue(interaction, {
                    auditLabel: "NR-GOTM",
                    tokenPrefix: "nr-gotm",
                    round: entry.round,
                    roundLabel,
                    gameIndex: null,
                    gameTitle: null,
                    field: "votingResults",
                    winners: entry.gameOfTheMonth.map((g) => g.title),
                    rawEntry: entry,
                    promptMessage,
                    useEditReply,
                });
                promptMessage = res.promptMessage;
                if (res.result === "stop") {
                    stopped = true;
                    break;
                }
                if (res.result && res.result.action === "value") {
                    await updateNrGotmVotingResultsInDatabase(entry.round, res.result.value);
                    NrGotm.updateVotingResultsByRound(entry.round, res.result.value);
                }
                else if (res.result && res.result.action === "no-value") {
                    await updateNrGotmVotingResultsInDatabase(entry.round, AUDIT_NO_VALUE_SENTINEL);
                    NrGotm.updateVotingResultsByRound(entry.round, AUDIT_NO_VALUE_SENTINEL);
                }
            }
        }
        if (promptMessage) {
            const finalContent = stopped ? "Audit stopped." : "Audit completed.";
            try {
                if (interaction.editReply && promptMessage && promptMessage.id === (await interaction.fetchReply().catch(() => null))?.id) {
                    await interaction.editReply({ content: finalContent, embeds: [], components: [] });
                }
                else {
                    await promptMessage.edit({ content: finalContent, embeds: [], components: [] });
                }
            }
            catch (err) {
                if (err?.code !== 10008)
                    throw err;
                await safeReply(interaction, { content: finalContent });
            }
        }
        else {
            if (stopped) {
                await safeReply(interaction, { content: "Audit stopped." });
            }
            else {
                await safeReply(interaction, { content: "Audit completed." });
            }
        }
    }
    async setNextVote(dateText, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isSuperAdmin(interaction);
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
                content: `Next vote date updated to ${parsed.toLocaleDateString()}. `,
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
        const okToUseCommand = await isSuperAdmin(interaction);
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
        const okToUseCommand = await isSuperAdmin(interaction);
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
        const okToUseCommand = await isSuperAdmin(interaction);
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
            nullableField = false;
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
        const okToUseCommand = await isSuperAdmin(interaction);
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
    async deleteGotm(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isSuperAdmin(interaction);
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
                content: `Error loading GOTM data: ${msg}`,
            });
            return;
        }
        if (!allEntries.length) {
            await safeReply(interaction, {
                content: "No GOTM rounds exist to delete.",
            });
            return;
        }
        const latestRound = Math.max(...allEntries.map((e) => e.round));
        const latestEntry = allEntries.find((e) => e.round === latestRound);
        if (!latestEntry) {
            await safeReply(interaction, {
                content: "Could not determine the most recent GOTM round to delete.",
            });
            return;
        }
        const summary = formatGotmEntryForEdit(latestEntry);
        await safeReply(interaction, {
            content: [
                `You are about to delete GOTM round ${latestRound} (${latestEntry.monthYear}).`,
                "",
                "Current data:",
                "```",
                summary,
                "```",
            ].join("\n"),
        });
        const confirm = await promptUserForInput(interaction, `Type \`yes\` to confirm deletion of GOTM round ${latestRound}, or \`cancel\` to abort.`);
        if (confirm === null) {
            return;
        }
        if (confirm.toLowerCase() !== "yes") {
            await safeReply(interaction, {
                content: "Delete cancelled.",
            });
            return;
        }
        try {
            const rowsDeleted = await deleteGotmRoundFromDatabase(latestRound);
            if (!rowsDeleted) {
                await safeReply(interaction, {
                    content: `No database rows were deleted for GOTM round ${latestRound}. It may not exist in the database.`,
                });
                return;
            }
            Gotm.deleteRound(latestRound);
            await safeReply(interaction, {
                content: [
                    `Deleted GOTM round ${latestRound} (${latestEntry.monthYear}).`,
                    `Database rows deleted: ${rowsDeleted}.`,
                    "",
                    "Deleted data:",
                    "```",
                    summary,
                    "```",
                ].join("\n"),
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to delete GOTM round ${latestRound}: ${msg}`,
            });
        }
    }
    async deleteNrGotm(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isSuperAdmin(interaction);
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
                content: `Error loading NR-GOTM data: ${msg}`,
            });
            return;
        }
        if (!allEntries.length) {
            await safeReply(interaction, {
                content: "No NR-GOTM rounds exist to delete.",
            });
            return;
        }
        const latestRound = Math.max(...allEntries.map((e) => e.round));
        const latestEntry = allEntries.find((e) => e.round === latestRound);
        if (!latestEntry) {
            await safeReply(interaction, {
                content: "Could not determine the most recent NR-GOTM round to delete.",
            });
            return;
        }
        const summary = formatGotmEntryForEdit(latestEntry);
        await safeReply(interaction, {
            content: [
                `You are about to delete NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
                "",
                "Current data:",
                "```",
                summary,
                "```",
            ].join("\n"),
        });
        const confirm = await promptUserForInput(interaction, `Type \`yes\` to confirm deletion of NR-GOTM round ${latestRound}, or \`cancel\` to abort.`);
        if (confirm === null) {
            return;
        }
        if (confirm.toLowerCase() !== "yes") {
            await safeReply(interaction, {
                content: "Delete cancelled.",
            });
            return;
        }
        try {
            const rowsDeleted = await deleteNrGotmRoundFromDatabase(latestRound);
            if (!rowsDeleted) {
                await safeReply(interaction, {
                    content: `No database rows were deleted for NR-GOTM round ${latestRound}. It may not exist in the database.`,
                });
                return;
            }
            NrGotm.deleteRound(latestRound);
            await safeReply(interaction, {
                content: [
                    `Deleted NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
                    `Database rows deleted: ${rowsDeleted}.`,
                    "",
                    "Deleted data:",
                    "```",
                    summary,
                    "```",
                ].join("\n"),
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to delete NR-GOTM round ${latestRound}: ${msg}`,
            });
        }
    }
    async help(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const response = buildSuperAdminHelpResponse();
        await safeReply(interaction, {
            ...response,
            ephemeral: true,
        });
    }
    async handleSuperAdminHelpButton(interaction) {
        const topicId = extractSuperAdminTopicId(interaction.customId);
        const topic = topicId ? SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;
        if (!topic) {
            const response = buildSuperAdminHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that superadmin help topic. Showing the superadmin help menu.",
            });
            return;
        }
        const helpEmbed = buildSuperAdminHelpEmbed(topic);
        const response = buildSuperAdminHelpResponse(topic.id);
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
], SuperAdmin.prototype, "presence", null);
__decorate([
    ButtonComponent({ id: /^superadmin-presence-restore-\d+$/ })
], SuperAdmin.prototype, "handleSuperAdminPresenceRestore", null);
__decorate([
    ButtonComponent({ id: "superadmin-presence-cancel" })
], SuperAdmin.prototype, "handleSuperAdminPresenceCancel", null);
__decorate([
    ButtonComponent({ id: /^(gotm|nr-gotm)-audit-(stop|skip|novalue)-.+/ })
], SuperAdmin.prototype, "handleAuditButtons", null);
__decorate([
    Slash({
        description: "Audit GOTM data for missing fields",
        name: "gotm-data-audit",
    }),
    __param(0, SlashOption({
        description: "Ask only about missing thread IDs",
        name: "threadid",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Ask only about missing Reddit URLs",
        name: "redditurl",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(2, SlashOption({
        description: "Ask only about missing voting result message IDs",
        name: "votingresults",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(3, SlashOption({
        description: "Order to audit rounds (asc or desc, default desc)",
        name: "order",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "If true, show prompts in-channel (not ephemeral)",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], SuperAdmin.prototype, "gotmDataAudit", null);
__decorate([
    Slash({
        description: "Audit NR-GOTM data for missing fields",
        name: "nr-gotm-data-audit",
    }),
    __param(0, SlashOption({
        description: "Ask only about missing thread IDs",
        name: "threadid",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Ask only about missing Reddit URLs",
        name: "redditurl",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(2, SlashOption({
        description: "Ask only about missing voting result message IDs",
        name: "votingresults",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(3, SlashOption({
        description: "Order to audit rounds (asc or desc, default desc)",
        name: "order",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], SuperAdmin.prototype, "nrGotmDataAudit", null);
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
], SuperAdmin.prototype, "setNextVote", null);
__decorate([
    Slash({ description: "Add a new GOTM round", name: "add-gotm" })
], SuperAdmin.prototype, "addGotm", null);
__decorate([
    Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
], SuperAdmin.prototype, "addNrGotm", null);
__decorate([
    Slash({ description: "Edit GOTM data by round", name: "edit-gotm" }),
    __param(0, SlashOption({
        description: "Round number to edit",
        name: "round",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], SuperAdmin.prototype, "editGotm", null);
__decorate([
    Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" }),
    __param(0, SlashOption({
        description: "NR-GOTM Round number to edit",
        name: "round",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], SuperAdmin.prototype, "editNrGotm", null);
__decorate([
    Slash({
        description: "Delete the most recent GOTM round",
        name: "delete-gotm",
    })
], SuperAdmin.prototype, "deleteGotm", null);
__decorate([
    Slash({
        description: "Delete the most recent NR-GOTM round",
        name: "delete-nr-gotm",
    })
], SuperAdmin.prototype, "deleteNrGotm", null);
__decorate([
    Slash({ description: "Show help for server owner commands", name: "help" })
], SuperAdmin.prototype, "help", null);
__decorate([
    ButtonComponent({ id: /^superadmin-help-.+/ })
], SuperAdmin.prototype, "handleSuperAdminHelpButton", null);
SuperAdmin = __decorate([
    Discord(),
    SlashGroup({ description: "Server Owner Commands", name: "superadmin" }),
    SlashGroup("superadmin")
], SuperAdmin);
export { SuperAdmin };
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
        const threadId = displayAuditValue(game.threadId);
        const redditUrl = displayAuditValue(game.redditUrl);
        lines.push(`${num}) Title: ${game.title}`);
        lines.push(`   Thread: ${threadId ?? "(none)"}`);
        lines.push(`   Reddit: ${redditUrl ?? "(none)"}`);
    });
    return lines.join("\n");
}
export async function isSuperAdmin(interaction) {
    const anyInteraction = interaction;
    const guild = interaction.guild;
    const userId = interaction.user.id;
    if (!guild) {
        await safeReply(interaction, {
            content: "This command can only be used inside a server.",
        });
        return false;
    }
    const ownerId = guild.ownerId;
    const isOwner = ownerId === userId;
    if (!isOwner) {
        const denial = {
            content: "Access denied. Command is restricted to the server owner.",
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
            // ignore
        }
    }
    return isOwner;
}
export function buildSuperAdminHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("Superadmin Commands Help")
        .setDescription("Choose a `/superadmin` subcommand button to view details (server owner only).");
    const components = buildSuperAdminHelpButtons(activeTopicId);
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
function buildSuperAdminPresenceButtons(count) {
    const buttons = [];
    for (let i = 0; i < count; i++) {
        buttons.push(new ButtonBuilder()
            .setCustomId(`superadmin-presence-restore-${i}`)
            .setLabel(String(i + 1))
            .setStyle(ButtonStyle.Success));
    }
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId("superadmin-presence-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger)));
    return rows;
}
