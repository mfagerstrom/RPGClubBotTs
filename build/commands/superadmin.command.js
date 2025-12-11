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
import Gotm, { updateGotmGameFieldInDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, } from "../classes/NrGotm.js";
import Member from "../classes/Member.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { getOraclePool } from "../db/oracleClient.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { loadGotmFromDb } from "../classes/Gotm.js";
import { loadNrGotmFromDb } from "../classes/NrGotm.js";
import { setThreadGameLink } from "../classes/Thread.js";
const SUPERADMIN_PRESENCE_CHOICES = new Map();
const GAMEDB_IMPORT_PROMPTS = new Map();
const GAMEDB_SESSION_LIMIT = 10;
export const SUPERADMIN_HELP_TOPICS = [
    {
        id: "memberscan",
        label: "/superadmin memberscan",
        summary: "Scan the server and refresh member records in the database.",
        syntax: "Syntax: /superadmin memberscan",
        notes: "Runs in the current server. Make sure env role IDs are set so roles classify correctly.",
    },
    {
        id: "gamedb-backfill",
        label: "/superadmin gamedb-backfill",
        summary: "Import all GOTM and NR-GOTM titles into GameDB with IGDB lookups.",
        syntax: "Syntax: /superadmin gamedb-backfill",
        notes: "Prompts if IGDB returns multiple matches; skips anything already in GameDB.",
    },
    {
        id: "thread-game-link-backfill",
        label: "/superadmin thread-game-link-backfill",
        summary: "Backfill thread-to-GameDB links using existing GOTM/NR-GOTM data.",
        syntax: "Syntax: /superadmin thread-game-link-backfill",
        notes: "Uses GOTM/NR-GOTM tables to set missing GameDB IDs on threads.",
    },
];
function buildSuperAdminHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("superadmin-help-select")
        .setPlaceholder("/superadmin help")
        .addOptions(SUPERADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
async function downloadImageBuffer(url) {
    const resp = await axios.get(url, { responseType: "arraybuffer" });
    const mime = resp.headers?.["content-type"] ?? null;
    return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
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
        const topicId = interaction.values?.[0];
        if (topicId === "help-main") {
            const { buildMainHelpResponse } = await import("./help.command.js");
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
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
        const totalPending = seeds.length;
        const sessionSeeds = seeds.slice(0, GAMEDB_SESSION_LIMIT);
        if (!sessionSeeds.length) {
            await safeReply(interaction, {
                content: "No GOTM or NR-GOTM entries found to import.",
                ephemeral: true,
            });
            return;
        }
        const status = {
            total: sessionSeeds.length,
            processed: 0,
            logs: [],
            pendingTotal: totalPending,
        };
        const startMessage = `Starting GameDB backfill for ${sessionSeeds.length} of ${totalPending} pending titles ` +
            `(max ${GAMEDB_SESSION_LIMIT} per run)...`;
        const statusMessage = await safeReply(interaction, {
            content: startMessage,
            embeds: [this.buildGamedbStatusEmbed(startMessage, status.logs, false)],
            ephemeral: false,
            fetchReply: true,
        });
        for (const seed of sessionSeeds) {
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
    async threadGameLinkBackfill(interaction) {
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
                content: `Failed to load GOTM/NR-GOTM data: ${msg}`,
                ephemeral: true,
            });
            return;
        }
        const assignments = [];
        Gotm.all().forEach((entry) => {
            entry.gameOfTheMonth.forEach((game) => {
                if (game.threadId && game.gamedbGameId) {
                    assignments.push({ threadId: game.threadId, gamedbGameId: game.gamedbGameId, source: "GOTM" });
                }
            });
        });
        NrGotm.all().forEach((entry) => {
            entry.gameOfTheMonth.forEach((game) => {
                if (game.threadId && game.gamedbGameId) {
                    assignments.push({ threadId: game.threadId, gamedbGameId: game.gamedbGameId, source: "NR-GOTM" });
                }
            });
        });
        if (!assignments.length) {
            await safeReply(interaction, {
                content: "No GOTM or NR-GOTM entries have both thread id and GameDB id set.",
                ephemeral: true,
            });
            return;
        }
        let success = 0;
        const failures = [];
        for (const a of assignments) {
            try {
                await setThreadGameLink(a.threadId, a.gamedbGameId);
                success++;
            }
            catch (err) {
                failures.push(`${a.source} thread ${a.threadId} -> game ${a.gamedbGameId}: ${err?.message ?? err}`);
            }
        }
        const lines = [`Updated ${success} thread link(s).`];
        if (failures.length) {
            lines.push("Failures:");
            lines.push(...failures.map((f) => `• ${f}`));
        }
        await safeReply(interaction, {
            content: lines.join("\n"),
            ephemeral: true,
        });
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
        let searchTerm = seed.title;
        while (true) {
            let igdbMatches = [];
            try {
                const searchRes = await igdbService.searchGames(searchTerm, 8);
                igdbMatches = searchRes.results;
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                return `[${label}] IGDB search failed: ${msg}`;
            }
            if (!igdbMatches.length) {
                return `[${label}] No IGDB match for "${searchTerm}"`;
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
                const selection = await this.promptForIgdbSelection(interaction, seed, igdbMatches, searchTerm);
                if (selection.newQuery) {
                    searchTerm = selection.newQuery;
                    continue;
                }
                if (selection.skipped) {
                    return `[${label}] Skipped (no selection): ${seed.title}`;
                }
                selectedId = selection.selectedId;
            }
            if (!selectedId) {
                return `[${label}] Skipped (no selection): ${seed.title}`;
            }
            return this.importGameFromIgdb(selectedId, label, seed);
        }
    }
    async promptForIgdbSelection(interaction, seed, matches, searchTerm) {
        const options = matches.slice(0, 23).map((game) => {
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
        options.push({
            label: "Search with a different title",
            value: "search-new",
            description: "Type a new search string in this channel, then re-run the lookup",
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
        if (!prompt) {
            return { selectedId: null, newQuery: null, skipped: true };
        }
        const selection = await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                GAMEDB_IMPORT_PROMPTS.delete(customId);
                resolve(null);
            }, 60_000);
            GAMEDB_IMPORT_PROMPTS.set(customId, (val) => {
                clearTimeout(timeout);
                GAMEDB_IMPORT_PROMPTS.delete(customId);
                resolve(val);
            });
        });
        if (selection === "skip" || selection === null) {
            return { selectedId: null, newQuery: null, skipped: true };
        }
        if (selection === "search-new") {
            const newQuery = await this.promptForNewIgdbSearch(interaction, seed, searchTerm);
            return {
                selectedId: null,
                newQuery,
                skipped: !newQuery,
            };
        }
        const selected = Number(selection);
        return {
            selectedId: Number.isFinite(selected) ? selected : null,
            newQuery: null,
            skipped: false,
        };
    }
    async promptForNewIgdbSearch(interaction, seed, searchTerm) {
        const channel = interaction.channel;
        const userId = interaction.user.id;
        if (!channel || typeof channel.awaitMessages !== "function") {
            await safeReply(interaction, {
                content: "Cannot prompt for a new search; use this command in a text channel.",
                ephemeral: true,
            });
            return null;
        }
        const prompt = `Reply in this channel with a new search string for "${seed.title}" ` +
            `(current search: "${searchTerm}").`;
        await safeReply(interaction, { content: prompt, ephemeral: false });
        try {
            const collected = await channel.awaitMessages({
                filter: (m) => m.author?.id === userId,
                max: 1,
                time: 120_000,
            });
            const first = collected?.first?.();
            if (!first)
                return null;
            const content = (first.content ?? "").trim();
            try {
                await first.delete();
            }
            catch {
                // ignore delete failures
            }
            if (!content || /^cancel$/i.test(content)) {
                return null;
            }
            return content;
        }
        catch {
            return null;
        }
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
        const progress = status.pendingTotal
            ? `${status.processed}/${status.total} (of ${status.pendingTotal} pending)`
            : `${status.processed}/${status.total}`;
        const header = done
            ? `GameDB backfill complete. Processed ${progress}. Audit complete.`
            : `GameDB backfill in progress... (${progress})`;
        const embed = this.buildGamedbStatusEmbed(header, status.logs, done);
        try {
            if (message && typeof message.edit === "function") {
                await message.edit({ embeds: [embed] });
            }
            else {
                await safeReply(interaction, { embeds: [embed], ephemeral: false });
            }
        }
        catch {
            // ignore status update failures
        }
    }
    buildGamedbStatusEmbed(header, logs, done) {
        const recentLogs = this.chunkLines(logs).slice(-1);
        const description = [header, ...recentLogs].join("\n\n").trim();
        return new EmbedBuilder()
            .setTitle("GameDB Backfill Audit")
            .setDescription(description)
            .setColor(done ? 0x2ecc71 : 0x3498db);
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
    Slash({ description: "Show help for server owner commands", name: "help" })
], SuperAdmin.prototype, "help", null);
__decorate([
    SelectMenuComponent({ id: "superadmin-help-select" })
], SuperAdmin.prototype, "handleSuperAdminHelpButton", null);
__decorate([
    Slash({
        description: "Import GOTM and NR-GOTM titles into the GameDB (interactive IGDB search)",
        name: "gamedb-backfill",
    })
], SuperAdmin.prototype, "gamedbBackfill", null);
__decorate([
    Slash({
        description: "Backfill THREADS.GAMEDB_GAME_ID from GOTM / NR-GOTM thread links",
        name: "thread-game-link-backfill",
    })
], SuperAdmin.prototype, "threadGameLinkBackfill", null);
__decorate([
    SelectMenuComponent({ id: /^gamedb-import-\d+$/ })
], SuperAdmin.prototype, "handleGamedbImportSelect", null);
SuperAdmin = __decorate([
    Discord(),
    SlashGroup({ description: "Server Owner Commands", name: "superadmin" }),
    SlashGroup("superadmin")
], SuperAdmin);
export { SuperAdmin };
export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";
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
        .setDescription("Pick a `/superadmin` command to see what it does and how to run it (server owner only).");
    const components = buildSuperAdminHelpButtons(activeTopicId);
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
