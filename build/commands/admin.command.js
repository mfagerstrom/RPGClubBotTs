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
import Gotm, { updateGotmGameFieldInDatabase, insertGotmRoundInDatabase, } from "../classes/Gotm.js";
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
            const summary = formatGotmEntryForEdit(newEntry);
            await safeReply(interaction, {
                content: [
                    `Created GOTM round ${nextRound}.`,
                    "",
                    "New data:",
                    "```",
                    summary,
                    "```",
                ].join("\n"),
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to create GOTM round ${nextRound}: ${msg}`,
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
        const summary = formatGotmEntryForEdit(entry);
        await safeReply(interaction, {
            content: [
                `Editing GOTM round ${roundNumber}.`,
                "",
                "Current data:",
                "```",
                summary,
                "```",
            ].join("\n"),
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
            const updatedSummary = updatedEntry ? formatGotmEntryForEdit(updatedEntry) : summary;
            await safeReply(interaction, {
                content: [
                    `GOTM round ${roundNumber} updated successfully.`,
                    "",
                    "Updated data:",
                    "```",
                    updatedSummary,
                    "```",
                ].join("\n"),
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to update GOTM round ${roundNumber}: ${msg}`,
            });
        }
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
            name: "/admin add-gotm",
            value: "Interactively add a new GOTM round.\n" +
                "**Syntax:** `/admin add-gotm`\n" +
                "**Notes:** The round number is always assigned automatically as the next round after the current highest GOTM round.",
        }, {
            name: "/admin edit-gotm",
            value: "Interactively edit GOTM data for a given round.\n" +
                "**Syntax:** `/admin edit-gotm round:<integer>`\n" +
                "**Parameters:** `round` (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
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
    Slash({ description: "Add a new GOTM round", name: "add-gotm" })
], Admin.prototype, "addGotm", null);
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
    Slash({ description: "Show help for admin commands", name: "help" })
], Admin.prototype, "help", null);
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
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
        await safeReply(interaction, {
            content: 'Access denied.  Command requires Administrator role.'
        });
    }
    return isAdmin;
}
