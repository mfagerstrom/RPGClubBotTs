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
import { DateTime } from "luxon";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, { updateGotmGameFieldInDatabase, insertGotmRoundInDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, insertNrGotmRoundInDatabase, } from "../classes/NrGotm.js";
import Game from "../classes/Game.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { buildNominationDeleteView, handleNominationDeletionButton, buildNominationDeleteViewEmbed, announceNominationChange, } from "../functions/NominationAdminHelpers.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import { deleteNominationForUser, getNominationForUser, listNominationsForRound, } from "../classes/Nomination.js";
export const ADMIN_HELP_TOPICS = [
    {
        id: "add-gotm",
        label: "/admin add-gotm",
        summary: "Add the next GOTM round with guided prompts.",
        syntax: "Syntax: /admin add-gotm",
        notes: "Round number is auto-assigned to the next open round.",
    },
    {
        id: "edit-gotm",
        label: "/admin edit-gotm",
        summary: "Update details for a specific GOTM round.",
        syntax: "Syntax: /admin edit-gotm round:<integer>",
        parameters: "round (required) — GOTM round to edit. The bot shows current data and lets you pick what to change.",
    },
    {
        id: "add-nr-gotm",
        label: "/admin add-nr-gotm",
        summary: "Add the next NR-GOTM round with guided prompts.",
        syntax: "Syntax: /admin add-nr-gotm",
        notes: "Round number is auto-assigned to the next open NR-GOTM round.",
    },
    {
        id: "edit-nr-gotm",
        label: "/admin edit-nr-gotm",
        summary: "Update details for a specific NR-GOTM round.",
        syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
        parameters: "round (required) — NR-GOTM round to edit. The bot shows current data and lets you pick what to change.",
    },
    {
        id: "delete-gotm-nomination",
        label: "/admin delete-gotm-nomination",
        summary: "Remove a user’s GOTM nomination for the upcoming round and announce it.",
        syntax: "Syntax: /admin delete-gotm-nomination user:<user> reason:<string>",
        notes: "Targets the upcoming nomination set. A public update is posted with the refreshed list.",
    },
    {
        id: "delete-nr-gotm-nomination",
        label: "/admin delete-nr-gotm-nomination",
        summary: "Remove a user’s NR-GOTM nomination for the upcoming round and announce it.",
        syntax: "Syntax: /admin delete-nr-gotm-nomination user:<user> reason:<string>",
        notes: "Targets the upcoming nomination set. A public update is posted with the refreshed list.",
    },
    {
        id: "set-nextvote",
        label: "/admin set-nextvote",
        summary: "Set when the next GOTM/NR-GOTM vote will happen.",
        syntax: "Syntax: /admin set-nextvote date:<date>",
        notes: "Votes are typically held the last Friday of the month.",
    },
    {
        id: "voting-setup",
        label: "/admin voting-setup",
        summary: "Build ready-to-paste Subo /poll commands from current nominations.",
        syntax: "Syntax: /admin voting-setup",
        notes: "Pulls current nominations for GOTM and NR-GOTM, sorts answers, and sets a sensible max_select.",
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
        .setDescription("Pick an `/admin` command below to see what it does and how to use it.");
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
let Admin = class Admin {
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
    async deleteGotmNomination(user, reason, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        try {
            const window = await getUpcomingNominationWindow();
            const targetRound = window.targetRound;
            const nomination = await getNominationForUser("gotm", targetRound, user.id);
            const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
            const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;
            if (!nomination) {
                await safeReply(interaction, {
                    content: `No GOTM nomination found for Round ${targetRound} by ${targetName}.`,
                    ephemeral: true,
                });
                return;
            }
            await deleteNominationForUser("gotm", targetRound, user.id);
            const nominations = await listNominationsForRound("gotm", targetRound);
            const embed = buildNominationDeleteViewEmbed("GOTM", "/gotm nominate", targetRound, window, nominations);
            const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
            const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for GOTM Round ${targetRound}. Reason: ${reason}`;
            await interaction.deleteReply().catch(() => { });
            await announceNominationChange("gotm", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to delete nomination: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async deleteNrGotmNomination(user, reason, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            await safeReply(interaction, { content: "Access denied. Command requires Administrator role.", ephemeral: true });
            return;
        }
        try {
            const window = await getUpcomingNominationWindow();
            const targetRound = window.targetRound;
            const nomination = await getNominationForUser("nr-gotm", targetRound, user.id);
            const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
            const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;
            if (!nomination) {
                await safeReply(interaction, {
                    content: `No NR-GOTM nomination found for Round ${targetRound} by ${targetName}.`,
                    ephemeral: true,
                });
                return;
            }
            await deleteNominationForUser("nr-gotm", targetRound, user.id);
            const nominations = await listNominationsForRound("nr-gotm", targetRound);
            const embed = buildNominationDeleteViewEmbed("NR-GOTM", "/nr-gotm nominate", targetRound, window, nominations);
            const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
            const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for NR-GOTM Round ${targetRound}. Reason: ${reason}`;
            await interaction.deleteReply().catch(() => { });
            await announceNominationChange("nr-gotm", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to delete nomination: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async deleteGotmNomsPanel(interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const window = await getUpcomingNominationWindow();
        const view = await buildNominationDeleteView("gotm", "/gotm nominate", "admin");
        if (!view) {
            await safeReply(interaction, {
                content: `No GOTM nominations found for Round ${window.targetRound}.`,
                ephemeral: true,
            });
            return;
        }
        await safeReply(interaction, {
            content: `Select a GOTM nomination to delete for Round ${window.targetRound}.`,
            embeds: [view.embed],
            components: view.components,
            ephemeral: true,
        });
    }
    async votingSetup(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand)
            return;
        try {
            const window = await getUpcomingNominationWindow();
            const roundNumber = window.targetRound;
            const nextMonth = (() => {
                const base = new Date();
                const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
                return d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
            })();
            const monthLabel = nextMonth || "the upcoming month";
            const gotmNoms = await listNominationsForRound("gotm", roundNumber);
            const nrNoms = await listNominationsForRound("nr-gotm", roundNumber);
            const buildPoll = (kindLabel, answers) => {
                if (!answers.length) {
                    return `${kindLabel}: (no nominations found for Round ${roundNumber})`;
                }
                const maxSelect = Math.max(1, Math.floor(answers.length / 2));
                const answersJoined = answers.join(";");
                const pollName = kindLabel === "GOTM"
                    ? `GOTM_Round_${roundNumber}`
                    : `NR-GOTM_Round_${roundNumber}`;
                const question = kindLabel === "GOTM"
                    ? `What Roleplaying Game(s) would you like to discuss in ${monthLabel}?`
                    : `What Non-Roleplaying Game(s) would you like to discuss in ${monthLabel}?`;
                // Calculate time until 8 PM Eastern
                const nowInEastern = DateTime.now().setZone("America/New_York");
                const today8pm = nowInEastern.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });
                let startOutput;
                let timeLimitOutput;
                if (nowInEastern < today8pm) {
                    const diff = today8pm.diff(nowInEastern).shiftTo("hours", "minutes", "seconds");
                    startOutput = diff.toFormat("h'h'm'm's's");
                    timeLimitOutput = "48h";
                }
                else {
                    startOutput = "1m";
                    // End at 8 PM on (Today + 2 days)
                    const targetEnd = today8pm.plus({ days: 2 });
                    const actualStart = nowInEastern.plus({ minutes: 1 });
                    const diff = targetEnd.diff(actualStart).shiftTo("hours", "minutes", "seconds");
                    timeLimitOutput = diff.toFormat("h'h'm'm's's");
                }
                return `/poll question:${question} answers:${answersJoined} max_select:${maxSelect} start:${startOutput} time_limit:${timeLimitOutput} vote_change:Yes realtime_results:🙈 Hidden privacy:🤐 Semi-private role_required:@members channel:#announcements name:${pollName} final_reveal:Yes`;
            };
            const gotmAnswers = gotmNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);
            const nrAnswers = nrNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);
            const gotmPoll = buildPoll("GOTM", gotmAnswers);
            const nrPoll = buildPoll("NR-GOTM", nrAnswers);
            const adminChannelId = "428142514222923776";
            const adminChannel = adminChannelId
                ? await interaction.client.channels.fetch(adminChannelId).catch(() => null)
                : null;
            const messageContent = `GOTM:\n\`\`\`\n${gotmPoll}\n\`\`\`\nNR-GOTM:\n\`\`\`\n${nrPoll}\n\`\`\``;
            if (adminChannel && adminChannel.send) {
                await adminChannel.send({ content: messageContent });
                await safeReply(interaction, {
                    content: "Voting setup commands posted to #admin.",
                    ephemeral: true,
                });
            }
            else {
                await safeReply(interaction, {
                    content: messageContent,
                    ephemeral: true,
                });
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not generate vote commands: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async deleteNrGotmNomsPanel(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const window = await getUpcomingNominationWindow();
        const view = await buildNominationDeleteView("nr-gotm", "/nr-gotm nominate", "admin");
        if (!view) {
            await safeReply(interaction, {
                content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
                ephemeral: true,
            });
            return;
        }
        await safeReply(interaction, {
            content: `Select an NR-GOTM nomination to delete for Round ${window.targetRound}.`,
            embeds: [view.embed],
            components: view.components,
            ephemeral: true,
        });
    }
    async handleAdminNominationDeleteButton(interaction) {
        const okToUseCommand = await isAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const match = interaction.customId.match(/^admin-(gotm|nr-gotm)-nom-del-(\d+)-(\d+)$/);
        if (!match)
            return;
        const kind = match[1];
        const round = Number(match[2]);
        const userId = match[3];
        await handleNominationDeletionButton(interaction, kind, round, userId, "admin");
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
            const gamedbRaw = await promptUserForInput(interaction, `Enter the GameDB id for game #${n} (use /gamedb add first if needed).`);
            if (gamedbRaw === null)
                return;
            const gamedbId = Number(gamedbRaw.trim());
            if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
                await safeReply(interaction, { content: "Invalid GameDB id. Creation cancelled." });
                return;
            }
            const gameMeta = await Game.getGameById(gamedbId);
            if (!gameMeta) {
                await safeReply(interaction, {
                    content: `GameDB id ${gamedbId} not found. Use /gamedb add first.`,
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
                title: gameMeta.title,
                threadId,
                redditUrl,
                gamedbGameId: gamedbId,
            });
        }
        try {
            await insertGotmRoundInDatabase(nextRound, monthYear, games);
            const newEntry = Gotm.addRound(nextRound, monthYear, games);
            const embedAssets = await buildGotmEntryEmbed(newEntry, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `Created GOTM round ${nextRound}.`,
                embeds: [embedAssets.embed],
                files: embedAssets.files?.length ? embedAssets.files : undefined,
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
            const gamedbRaw = await promptUserForInput(interaction, `Enter the GameDB id for NR-GOTM game #${n} (use /gamedb add first if needed).`);
            if (gamedbRaw === null)
                return;
            const gamedbId = Number(gamedbRaw.trim());
            if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
                await safeReply(interaction, { content: "Invalid GameDB id. Creation cancelled." });
                return;
            }
            const gameMeta = await Game.getGameById(gamedbId);
            if (!gameMeta) {
                await safeReply(interaction, {
                    content: `GameDB id ${gamedbId} not found. Use /gamedb add first.`,
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
                title: gameMeta.title,
                threadId,
                redditUrl,
                gamedbGameId: gamedbId,
            });
        }
        try {
            const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
            const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
            const newEntry = NrGotm.addRound(nextRound, monthYear, gamesWithIds);
            const embedAssets = await buildNrGotmEntryEmbed(newEntry, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `Created NR-GOTM round ${nextRound}.`,
                embeds: [embedAssets.embed],
                files: embedAssets.files?.length ? embedAssets.files : undefined,
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
        const embedAssets = await buildGotmEntryEmbed(entry, interaction.guildId ?? undefined, interaction.client);
        await safeReply(interaction, {
            content: `Editing GOTM round ${roundNumber}.`,
            embeds: [embedAssets.embed],
            files: embedAssets.files?.length ? embedAssets.files : undefined,
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
        const fieldAnswerRaw = await promptUserForInput(interaction, "Which field do you want to edit? Type one of: `gamedb`, `thread`, `reddit`. Type `cancel` to abort.");
        if (fieldAnswerRaw === null) {
            return;
        }
        const fieldAnswer = fieldAnswerRaw.toLowerCase();
        let field = null;
        let nullableField = false;
        if (fieldAnswer === "gamedb") {
            field = "gamedbGameId";
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
            : `Enter the new value for ${fieldAnswer} (GameDB id required).`;
        const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
        if (valueAnswerRaw === null) {
            return;
        }
        const valueTrimmed = valueAnswerRaw.trim();
        let newValue = valueTrimmed;
        if (nullableField && /^none|null$/i.test(valueTrimmed)) {
            newValue = null;
        }
        else if (field === "gamedbGameId") {
            const parsed = Number(valueTrimmed);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                await safeReply(interaction, {
                    content: "Please provide a valid numeric GameDB id.",
                });
                return;
            }
            const game = await Game.getGameById(parsed);
            if (!game) {
                await safeReply(interaction, {
                    content: `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
                });
                return;
            }
            newValue = parsed;
        }
        try {
            await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field, newValue);
            let updatedEntry = null;
            if (field === "gamedbGameId") {
                updatedEntry = Gotm.updateGamedbIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "threadId") {
                updatedEntry = Gotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "redditUrl") {
                updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
            }
            const entryToShow = updatedEntry ?? entry;
            const updatedAssets = await buildGotmEntryEmbed(entryToShow, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `GOTM round ${roundNumber} updated successfully.`,
                embeds: [updatedAssets.embed],
                files: updatedAssets.files?.length ? updatedAssets.files : undefined,
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
        const embedAssets = await buildNrGotmEntryEmbed(entry, interaction.guildId ?? undefined, interaction.client);
        await safeReply(interaction, {
            content: `Editing NR-GOTM round ${roundNumber}.`,
            embeds: [embedAssets.embed],
            files: embedAssets.files?.length ? embedAssets.files : undefined,
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
        const fieldAnswerRaw = await promptUserForInput(interaction, "Which field do you want to edit? Type one of: `gamedb`, `thread`, `reddit`. Type `cancel` to abort.");
        if (fieldAnswerRaw === null) {
            return;
        }
        const fieldAnswer = fieldAnswerRaw.toLowerCase();
        let field = null;
        let nullableField = false;
        if (fieldAnswer === "gamedb") {
            field = "gamedbGameId";
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
            : `Enter the new value for ${fieldAnswer} (GameDB id required).`;
        const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
        if (valueAnswerRaw === null) {
            return;
        }
        const valueTrimmed = valueAnswerRaw.trim();
        let newValue = valueTrimmed;
        if (nullableField && /^none|null$/i.test(valueTrimmed)) {
            newValue = null;
        }
        else if (field === "gamedbGameId") {
            const parsed = Number(valueTrimmed);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                await safeReply(interaction, {
                    content: "Please provide a valid numeric GameDB id.",
                });
                return;
            }
            const game = await Game.getGameById(parsed);
            if (!game) {
                await safeReply(interaction, {
                    content: `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
                });
                return;
            }
            newValue = parsed;
        }
        try {
            await updateNrGotmGameFieldInDatabase({
                rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
                round: roundNumber,
                gameIndex,
                field: field,
                value: newValue,
            });
            let updatedEntry = null;
            if (field === "gamedbGameId") {
                updatedEntry = NrGotm.updateGamedbIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "threadId") {
                updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
            }
            else if (field === "redditUrl") {
                updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
            }
            const entryToShow = updatedEntry ?? entry;
            const updatedAssets = await buildNrGotmEntryEmbed(entryToShow, interaction.guildId ?? undefined, interaction.client);
            await safeReply(interaction, {
                content: `NR-GOTM round ${roundNumber} updated successfully.`,
                embeds: [updatedAssets.embed],
                files: updatedAssets.files?.length ? updatedAssets.files : undefined,
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
    Slash({
        description: "Delete any GOTM nomination for the upcoming round",
        name: "delete-gotm-nomination",
    }),
    __param(0, SlashOption({
        description: "User whose nomination should be removed",
        name: "user",
        required: true,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "Reason for deletion (required)",
        name: "reason",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "deleteGotmNomination", null);
__decorate([
    Slash({
        description: "Delete any NR-GOTM nomination for the upcoming round",
        name: "delete-nr-gotm-nomination",
    }),
    __param(0, SlashOption({
        description: "User whose nomination should be removed",
        name: "user",
        required: true,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "Reason for deletion (required)",
        name: "reason",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "deleteNrGotmNomination", null);
__decorate([
    Slash({
        description: "Interactive deletion of GOTM nominations for the upcoming round",
        name: "delete-gotm-noms",
    })
], Admin.prototype, "deleteGotmNomsPanel", null);
__decorate([
    Slash({
        description: "Generate Subo /poll commands for GOTM and NR-GOTM voting",
        name: "voting-setup",
    })
], Admin.prototype, "votingSetup", null);
__decorate([
    Slash({
        description: "Interactive deletion of NR-GOTM nominations for the upcoming round",
        name: "delete-nr-gotm-noms",
    })
], Admin.prototype, "deleteNrGotmNomsPanel", null);
__decorate([
    ButtonComponent({ id: /^admin-(gotm|nr-gotm)-nom-del-(\d+)-(\d+)$/ })
], Admin.prototype, "handleAdminNominationDeleteButton", null);
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
export async function isAdmin(interaction) {
    const anyInteraction = interaction;
    const member = interaction.member;
    const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
    const isAdmin = canCheck
        ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
        : false;
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
        catch {
            // swallow to avoid leaking
        }
    }
    return isAdmin;
}
