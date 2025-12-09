var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, } from "discord.js";
import axios from "axios";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption, SelectMenuComponent, } from "discordx";
import { getPresenceHistory, setPresence, setPresenceFromInteraction, } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, { updateGotmGameFieldInDatabase, insertGotmRoundInDatabase, deleteGotmRoundFromDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, insertNrGotmRoundInDatabase, deleteNrGotmRoundFromDatabase, } from "../classes/NrGotm.js";
import Member from "../classes/Member.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { buildNominationDeleteViewEmbed, announceNominationChange, } from "../functions/NominationAdminHelpers.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import { deleteNominationForUser, getNominationForUser, listNominationsForRound, } from "../classes/Nomination.js";
import { getOraclePool } from "../db/oracleClient.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { loadGotmFromDb } from "../classes/Gotm.js";
import { loadNrGotmFromDb } from "../classes/NrGotm.js";
const SUPERADMIN_PRESENCE_CHOICES = new Map();
const GAMEDB_IMPORT_PROMPTS = new Map();
export const SUPERADMIN_HELP_TOPICS = [
    {
        id: "presence",
        label: "/superadmin presence",
        summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
        syntax: "Syntax: /superadmin presence [text:<string>]",
        parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
    },
    {
        id: "memberscan",
        label: "/superadmin memberscan",
        summary: "Scan guild members and upsert them into RPG_CLUB_USERS.",
        syntax: "Syntax: /superadmin memberscan",
        notes: "Runs in the current guild; requires appropriate environment role IDs for classification.",
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
        id: "delete-gotm-nomination",
        label: "/superadmin delete-gotm-nomination",
        summary: "Delete any GOTM nomination for the upcoming round and announce it.",
        syntax: "Syntax: /superadmin delete-gotm-nomination user:<user> reason:<string>",
        notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
    },
    {
        id: "delete-nr-gotm-nomination",
        label: "/superadmin delete-nr-gotm-nomination",
        summary: "Delete any NR-GOTM nomination for the upcoming round and announce it.",
        syntax: "Syntax: /superadmin delete-nr-gotm-nomination user:<user> reason:<string>",
        notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
    },
    {
        id: "set-nextvote",
        label: "/superadmin set-nextvote",
        summary: "Set the date of the next GOTM/NR-GOTM vote.",
        syntax: "Syntax: /superadmin set-nextvote date:<date>",
        notes: "Votes are typically held the last Friday of the month.",
    },
    {
        id: "gamedb-backfill",
        label: "/superadmin gamedb-backfill",
        summary: "Import all GOTM and NR-GOTM titles into the GameDB using IGDB lookups.",
        syntax: "Syntax: /superadmin gamedb-backfill",
        notes: "Prompts for choice when IGDB returns multiple matches; skips titles already in GameDB.",
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
async function downloadImageBuffer(url) {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const mime = resp.headers?.["content-type"] ?? null;
    return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
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
    async memberScan(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const guild = interaction.guild;
        if (!guild) {
            await safeReply(interaction, { content: "This command must be run in a guild.", ephemeral: true });
            return;
        }
        const roleMap = {
            admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
        };
        await safeReply(interaction, { content: "Fetching all guild members... this may take a moment.", ephemeral: true });
        const members = await guild.members.fetch();
        const departedCount = await Member.markDepartedNotIn(Array.from(members.keys()));
        const pool = getOraclePool();
        let connection = await pool.getConnection();
        const isRecoverableOracleError = (err) => {
            const code = err?.code ?? err?.errorNum;
            const msg = err?.message ?? "";
            return (code === "NJS-500" ||
                code === "NJS-503" ||
                code === "ORA-03138" ||
                code === "ORA-03146" ||
                /DPI-1010|ORA-03135|end-of-file on communication channel/i.test(msg));
        };
        const reopenConnection = async () => {
            try {
                await connection?.close();
            }
            catch {
                // ignore
            }
            connection = await pool.getConnection();
        };
        let successCount = 0;
        let failCount = 0;
        const delay = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const avatarBuffersDifferent = (a, b) => {
            if (!a && !b)
                return false;
            if (!!a !== !!b)
                return true;
            if (!a || !b)
                return true;
            if (a.length !== b.length)
                return true;
            return !a.equals(b);
        };
        try {
            for (const member of members.values()) {
                const user = member.user;
                const existing = await Member.getByUserId(user.id);
                // Build avatar blob (throttled per-user)
                let avatarBlob = null;
                const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
                if (avatarUrl) {
                    try {
                        const { buffer } = await downloadImageBuffer(avatarUrl);
                        avatarBlob = buffer;
                    }
                    catch {
                        // ignore avatar fetch failures
                    }
                }
                const hasRole = (id) => {
                    if (!id)
                        return 0;
                    return member.roles.cache.has(id) ? 1 : 0;
                };
                const adminFlag = hasRole(roleMap.admin) || member.permissions.has("Administrator") ? 1 : 0;
                const moderatorFlag = hasRole(roleMap.mod) || member.permissions.has("ManageMessages") ? 1 : 0;
                const regularFlag = hasRole(roleMap.regular);
                const memberFlag = hasRole(roleMap.member);
                const newcomerFlag = hasRole(roleMap.newcomer);
                const baseRecord = {
                    userId: user.id,
                    isBot: user.bot ? 1 : 0,
                    username: user.username,
                    globalName: user.globalName ?? null,
                    avatarBlob: null,
                    serverJoinedAt: member.joinedAt ?? existing?.serverJoinedAt ?? null,
                    serverLeftAt: null,
                    lastSeenAt: existing?.lastSeenAt ?? null,
                    roleAdmin: adminFlag,
                    roleModerator: moderatorFlag,
                    roleRegular: regularFlag,
                    roleMember: memberFlag,
                    roleNewcomer: newcomerFlag,
                    messageCount: existing?.messageCount ?? null,
                    completionatorUrl: existing?.completionatorUrl ?? null,
                    psnUsername: existing?.psnUsername ?? null,
                    xblUsername: existing?.xblUsername ?? null,
                    nswFriendCode: existing?.nswFriendCode ?? null,
                    steamUrl: existing?.steamUrl ?? null,
                    profileImage: existing?.profileImage ?? null,
                    profileImageAt: existing?.profileImageAt ?? null,
                };
                let avatarToUse = avatarBlob;
                if (!avatarToUse && existing?.avatarBlob) {
                    avatarToUse = existing.avatarBlob;
                }
                else if (avatarToUse && existing?.avatarBlob) {
                    if (!avatarBuffersDifferent(avatarToUse, existing.avatarBlob)) {
                        avatarToUse = existing.avatarBlob;
                    }
                }
                const execUpsert = async (avatarData) => {
                    const record = { ...baseRecord, avatarBlob: avatarData };
                    await Member.upsert(record, { connection });
                };
                try {
                    await execUpsert(avatarToUse);
                    successCount++;
                }
                catch (err) {
                    const code = err?.code ?? err?.errorNum;
                    if (code === "ORA-03146") {
                        try {
                            await execUpsert(null);
                            successCount++;
                            continue;
                        }
                        catch (retryErr) {
                            failCount++;
                            console.error(`Failed to upsert user ${user.id} after stripping avatar`, retryErr);
                            continue;
                        }
                    }
                    if (isRecoverableOracleError(err)) {
                        await reopenConnection();
                        try {
                            await execUpsert(avatarBlob);
                            successCount++;
                            continue;
                        }
                        catch (retryErr) {
                            failCount++;
                            console.error(`Failed to upsert user ${user.id} after retry`, retryErr);
                        }
                    }
                    else {
                        failCount++;
                        console.error(`Failed to upsert user ${user.id}`, err);
                    }
                }
                // throttle: one user per second
                await delay(1000);
            }
        }
        finally {
            await connection.close();
        }
        await safeReply(interaction, {
            content: `Member scan complete. Upserts succeeded: ${successCount}. Failed: ${failCount}. ` +
                `Marked departed: ${departedCount}.`,
            ephemeral: true,
        });
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
            await updateNrGotmGameFieldInDatabase({
                rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
                round: roundNumber,
                gameIndex,
                field: field,
                value: newValue,
            });
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
        const summary = formatIGotmEntryForEdit(latestEntry);
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
        const summary = formatIGotmEntryForEdit(latestEntry);
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
    async deleteGotmNomination(user, reason, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand) {
            await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
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
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand) {
            await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
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
    async gamedbBackfill(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        try {
            await loadGotmFromDb();
            await loadNrGotmFromDb();
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to load GOTM data: ${msg}`,
                ephemeral: true,
            });
            return;
        }
        const seeds = this.buildGamedbSeeds();
        if (!seeds.length) {
            await safeReply(interaction, {
                content: "No GOTM or NR-GOTM entries found to import.",
                ephemeral: true,
            });
            return;
        }
        const status = {
            total: seeds.length,
            processed: 0,
            logs: [],
        };
        const statusMessage = await safeReply(interaction, {
            content: `Starting GameDB backfill for ${seeds.length} titles...`,
            ephemeral: false,
            fetchReply: true,
        });
        for (const seed of seeds) {
            const label = `${seed.source} Round ${seed.round} (${seed.monthYear})`;
            try {
                const line = await this.processGamedbSeed(interaction, seed, label);
                if (line)
                    status.logs.push(line);
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                status.logs.push(`[${label}] Error: ${msg}`);
            }
            status.processed++;
            await this.editStatusMessage(interaction, statusMessage, status);
            await this.delay(400);
        }
        await this.editStatusMessage(interaction, statusMessage, status, true);
    }
    buildGamedbSeeds() {
        const seeds = [];
        const gotmEntries = Gotm.all();
        gotmEntries.forEach((entry) => {
            entry.gameOfTheMonth.forEach((game, idx) => {
                if (game.gamedbGameId)
                    return;
                if (!game.title)
                    return;
                seeds.push({
                    title: game.title,
                    source: "GOTM",
                    round: entry.round,
                    monthYear: entry.monthYear,
                    gameIndex: idx,
                    gamedbGameId: game.gamedbGameId ?? null,
                });
            });
        });
        const nrEntries = NrGotm.all();
        nrEntries.forEach((entry) => {
            entry.gameOfTheMonth.forEach((game, idx) => {
                if (game.gamedbGameId)
                    return;
                if (!game.title)
                    return;
                seeds.push({
                    title: game.title,
                    source: "NR-GOTM",
                    round: entry.round,
                    monthYear: entry.monthYear,
                    gameIndex: idx,
                    gamedbGameId: game.gamedbGameId ?? null,
                });
            });
        });
        return seeds;
    }
    async processGamedbSeed(interaction, seed, label) {
        if (seed.gamedbGameId) {
            return `[${label}] Skipped (already linked) ${seed.title}`;
        }
        const existingByTitle = await Game.searchGames(seed.title);
        const exactMatch = existingByTitle.find((g) => g.title.toLowerCase() === seed.title.toLowerCase());
        if (exactMatch) {
            await this.linkGameToSeed(seed, exactMatch.id);
            return `[${label}] Linked existing GameDB #${exactMatch.id} to ${seed.title}`;
        }
        let igdbMatches = [];
        try {
            igdbMatches = await igdbService.searchGames(seed.title, 8);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            return `[${label}] IGDB search failed: ${msg}`;
        }
        if (!igdbMatches.length) {
            return `[${label}] No IGDB match for "${seed.title}"`;
        }
        const existingIgdb = await this.findExistingIgdbGame(igdbMatches);
        if (existingIgdb) {
            await this.linkGameToSeed(seed, existingIgdb.id);
            return `[${label}] Linked existing GameDB #${existingIgdb.id} to ${seed.title}`;
        }
        let selectedId = null;
        if (igdbMatches.length === 1) {
            selectedId = igdbMatches[0].id;
        }
        else {
            selectedId = await this.promptForIgdbSelection(interaction, seed, igdbMatches);
        }
        if (!selectedId) {
            return `[${label}] Skipped (no selection): ${seed.title}`;
        }
        return this.importGameFromIgdb(selectedId, label, seed);
    }
    async promptForIgdbSelection(interaction, seed, matches) {
        const options = matches.slice(0, 24).map((game) => {
            const year = game.first_release_date
                ? new Date(game.first_release_date * 1000).getFullYear()
                : "TBD";
            const rating = game.total_rating ? ` | ${Math.round(game.total_rating)}/100` : "";
            return {
                label: `${game.name} (${year})`.substring(0, 100),
                value: String(game.id),
                description: `${rating} ${game.summary ?? "No summary"}`.substring(0, 95),
            };
        });
        options.push({
            label: "Skip (do not import this title)",
            value: "skip",
            description: "Leave this GOTM/NR-GOTM un-imported",
        });
        const customId = `gamedb-import-${Date.now()}`;
        const menu = new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(`Select IGDB match for "${seed.title}"`)
            .addOptions(options);
        const row = new ActionRowBuilder().addComponents(menu);
        const payload = {
            content: `Multiple IGDB matches for ${seed.source} Round ${seed.round} (${seed.monthYear}).`,
            components: [row],
            fetchReply: true,
        };
        let prompt = null;
        const existing = this.__gamedbPromptMessage;
        if (existing && typeof existing.edit === "function") {
            try {
                prompt = (await existing.edit(payload));
            }
            catch {
                prompt = null;
            }
        }
        if (!prompt) {
            prompt = (await safeReply(interaction, { ...payload, ephemeral: false }));
            this.__gamedbPromptMessage = prompt ?? null;
        }
        if (!prompt)
            return null;
        return await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                GAMEDB_IMPORT_PROMPTS.delete(customId);
                resolve(null);
            }, 60_000);
            GAMEDB_IMPORT_PROMPTS.set(customId, (val) => {
                clearTimeout(timeout);
                GAMEDB_IMPORT_PROMPTS.delete(customId);
                if (val === "skip" || val === null) {
                    resolve(null);
                }
                else {
                    const selected = Number(val);
                    resolve(Number.isFinite(selected) ? selected : null);
                }
            });
        });
    }
    async findExistingIgdbGame(matches) {
        for (const match of matches) {
            const existing = await Game.getGameByIgdbId(match.id);
            if (existing) {
                return existing;
            }
        }
        return null;
    }
    async handleGamedbImportSelect(interaction) {
        const resolver = GAMEDB_IMPORT_PROMPTS.get(interaction.customId);
        if (!resolver) {
            await interaction.reply({
                content: "This selection has expired or was already handled.",
                ephemeral: true,
            }).catch(() => { });
            return;
        }
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        const val = interaction.values?.[0] ?? null;
        resolver(val);
        try {
            await interaction.message.edit({ components: [] });
        }
        catch {
            // ignore
        }
    }
    async importGameFromIgdb(igdbId, label, seed) {
        const details = await igdbService.getGameDetails(igdbId);
        if (!details) {
            return `[${label}] IGDB details unavailable for id ${igdbId}`;
        }
        const existing = details.id ? await Game.getGameByIgdbId(details.id) : null;
        if (existing) {
            return `[${label}] Skipped (IGDB already in GameDB #${existing.id}): ${details.name}`;
        }
        let imageData = null;
        if (details.cover?.image_id) {
            try {
                const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
                const resp = await axios.get(url, { responseType: "arraybuffer" });
                imageData = Buffer.from(resp.data);
            }
            catch {
                // ignore image failures
            }
        }
        const igdbUrl = details.url || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
        const newGame = await Game.createGame(details.name, details.summary ?? null, imageData, details.id, details.slug, details.total_rating ?? null, igdbUrl);
        await Game.saveFullGameMetadata(newGame.id, details);
        await this.saveReleaseDates(newGame.id, details);
        await this.linkGameToSeed(seed, newGame.id);
        return `[${label}] Imported "${newGame.title}" -> GameDB #${newGame.id}`;
    }
    async saveReleaseDates(gameId, details) {
        const releaseDates = details.release_dates;
        if (!releaseDates || !Array.isArray(releaseDates))
            return;
        for (const release of releaseDates) {
            const platformId = typeof release.platform === "number"
                ? release.platform
                : (release.platform?.id ?? null);
            const platformName = typeof release.platform === "object"
                ? release.platform?.name ?? null
                : null;
            if (!platformId || !release.region)
                continue;
            const platform = await Game.ensurePlatform({ id: platformId, name: platformName });
            const region = await Game.ensureRegion(release.region);
            if (!platform || !region)
                continue;
            try {
                await Game.addReleaseInfo(gameId, platform.id, region.id, "Physical", release.date ? new Date(release.date * 1000) : null, null);
            }
            catch {
                // ignore duplicate inserts
            }
        }
    }
    chunkLines(lines) {
        const chunks = [];
        let current = "";
        for (const line of lines) {
            const addition = `${line}\n`;
            if ((current + addition).length > 1800) {
                chunks.push(current.trimEnd());
                current = addition;
            }
            else {
                current += addition;
            }
        }
        if (current.trim())
            chunks.push(current.trimEnd());
        return chunks;
    }
    async delay(ms) {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }
    async editStatusMessage(interaction, message, status, done = false) {
        const header = done
            ? `GameDB backfill complete. Processed ${status.processed}/${status.total}.`
            : `GameDB backfill in progress... (${status.processed}/${status.total})`;
        const recentLogs = this.chunkLines(status.logs).slice(-1);
        const content = [header, "", ...recentLogs].join("\n").trim();
        try {
            if (message && typeof message.edit === "function") {
                await message.edit(content || header);
            }
            else {
                await safeReply(interaction, { content: content || header, ephemeral: false });
            }
        }
        catch {
            // ignore status update failures
        }
    }
    async linkGameToSeed(seed, gameId) {
        if (seed.source === "GOTM") {
            await updateGotmGameFieldInDatabase(seed.round, seed.gameIndex, "gamedbGameId", gameId);
            Gotm.updateGamedbIdByRound(seed.round, gameId, seed.gameIndex);
        }
        else {
            await updateNrGotmGameFieldInDatabase({
                round: seed.round,
                gameIndex: seed.gameIndex,
                field: "gamedbGameId",
                value: gameId,
            });
            NrGotm.updateGamedbIdByRound(seed.round, gameId, seed.gameIndex);
        }
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
    ButtonComponent({ id: /^(gotm|nr-gotm)-audit(img)?-(stop|skip|novalue).*-/ })
], SuperAdmin.prototype, "handleAuditButtons", null);
__decorate([
    Slash({ description: "Scan guild members and upsert into RPG_CLUB_USERS", name: "memberscan" })
], SuperAdmin.prototype, "memberScan", null);
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
], SuperAdmin.prototype, "deleteGotmNomination", null);
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
], SuperAdmin.prototype, "deleteNrGotmNomination", null);
__decorate([
    Slash({
        description: "Import GOTM and NR-GOTM titles into the GameDB (interactive IGDB search)",
        name: "gamedb-backfill",
    })
], SuperAdmin.prototype, "gamedbBackfill", null);
__decorate([
    SelectMenuComponent({ id: /^gamedb-import-\d+$/ })
], SuperAdmin.prototype, "handleGamedbImportSelect", null);
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
export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";
function isAuditNoValue(value) {
    return value === AUDIT_NO_VALUE_SENTINEL;
}
function displayAuditValue(value) {
    if (isAuditNoValue(value))
        return null;
    return value ?? null;
}
function formatIGotmEntryForEdit(entry) {
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
