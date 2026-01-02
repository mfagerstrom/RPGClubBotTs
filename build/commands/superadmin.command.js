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
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption, SelectMenuComponent, SlashChoice, } from "discordx";
import { getPresenceHistory, setPresence, } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import Gotm, { updateGotmGameFieldInDatabase, } from "../classes/Gotm.js";
import NrGotm, { updateNrGotmGameFieldInDatabase, } from "../classes/NrGotm.js";
import Member from "../classes/Member.js";
import { getOraclePool } from "../db/oracleClient.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { loadGotmFromDb } from "../classes/Gotm.js";
import { loadNrGotmFromDb } from "../classes/NrGotm.js";
import { setThreadGameLink } from "../classes/Thread.js";
import { createIgdbSession, deleteIgdbSession, } from "../services/IgdbSelectService.js";
import { COMPLETION_TYPES, parseCompletionDateInput, } from "./profile.command.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
const superadminCompletionAddSessions = new Map();
const SUPERADMIN_PRESENCE_CHOICES = new Map();
const GAMEDB_SESSION_LIMIT = 10;
export const SUPERADMIN_HELP_TOPICS = [
    {
        id: "completion-add-other",
        label: "/superadmin completion-add-other",
        summary: "Add a game completion for another user.",
        syntax: "Syntax: /superadmin completion-add-other user:<user> completion_type:<type> title:<string> [completion_date:<string>] [final_playtime_hours:<number>] [announce:<bool>]",
        notes: "Uses a search query to find or import the game.",
    },
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
    {
        id: "presence",
        label: "/superadmin presence",
        summary: "Set the bot's 'Now Playing' text (owner override).",
        syntax: "Syntax: /superadmin presence [text:<string>]",
        notes: "Leave text empty to browse/restore history.",
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
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const embed = buildPresenceHistoryEmbed(entries);
    const components = buildSuperAdminPresenceButtons(entries.length);
    await safeReply(interaction, {
        embeds: [embed],
        components,
        flags: MessageFlags.Ephemeral,
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
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        if (text && text.trim()) {
            await setPresence(interaction, text.trim());
            await safeReply(interaction, {
                content: `I'm now playing: ${text.trim()}!`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await showSuperAdminPresenceHistory(interaction);
    }
    async completionAddOther(user, completionType, query, completionDate, finalPlaytimeHours, announce, interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        if (!COMPLETION_TYPES.includes(completionType)) {
            await safeReply(interaction, {
                content: "Invalid completion type.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        let completedAt;
        try {
            completedAt = parseCompletionDateInput(completionDate);
        }
        catch (err) {
            await safeReply(interaction, {
                content: err?.message ?? "Invalid completion date.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (finalPlaytimeHours !== undefined &&
            (Number.isNaN(finalPlaytimeHours) || finalPlaytimeHours < 0)) {
            await safeReply(interaction, {
                content: "Final playtime must be a non-negative number of hours.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const playtime = finalPlaytimeHours === undefined ? null : finalPlaytimeHours;
        const searchTerm = query.trim();
        await this.promptCompletionSelection(interaction, searchTerm, {
            targetUserId: user.id,
            completionType,
            completedAt,
            finalPlaytimeHours: playtime,
            source: "existing",
            query: searchTerm,
            announce,
        });
    }
    async handleSuperAdminCompletionSelect(interaction) {
        const [, sessionId] = interaction.customId.split(":");
        const ctx = superadminCompletionAddSessions.get(sessionId);
        if (!ctx) {
            await interaction
                .reply({
                content: "This completion prompt has expired.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        // Since it's admin, we check if the interaction user is an admin, not necessarily the context target user
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const value = interaction.values?.[0];
        if (!value) {
            await interaction
                .reply({
                content: "No selection received.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        await interaction.deferUpdate().catch(() => { });
        try {
            await this.processCompletionSelection(interaction, value, ctx);
        }
        finally {
            superadminCompletionAddSessions.delete(sessionId);
            try {
                await interaction.editReply({ components: [] }).catch(() => { });
            }
            catch {
                // ignore
            }
        }
    }
    async promptCompletionSelection(interaction, searchTerm, ctx) {
        const localResults = await Game.searchGames(searchTerm);
        if (localResults.length) {
            const sessionId = `sacomp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            superadminCompletionAddSessions.set(sessionId, ctx);
            const options = localResults.slice(0, 24).map((game) => ({
                label: game.title.slice(0, 100),
                value: String(game.id),
                description: `GameDB #${game.id}`,
            }));
            options.push({
                label: "Import another game from IGDB",
                value: "import-igdb",
                description: "Search IGDB and import a new GameDB entry",
            });
            const select = new StringSelectMenuBuilder()
                .setCustomId(`sa-comp-add-select:${sessionId}`)
                .setPlaceholder("Select a game to log completion")
                .addOptions(options);
            await safeReply(interaction, {
                content: `Select the game for "${searchTerm}".`,
                components: [new ActionRowBuilder().addComponents(select)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await this.promptIgdbSelection(interaction, searchTerm, ctx);
    }
    async promptIgdbSelection(interaction, searchTerm, ctx) {
        if (interaction.isMessageComponent()) {
            const loading = { content: `Searching IGDB for "${searchTerm}"...`, components: [] };
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(loading);
            }
            else {
                await interaction.update(loading);
            }
        }
        const igdbSearch = await igdbService.searchGames(searchTerm);
        if (!igdbSearch.results.length) {
            const content = `No GameDB or IGDB matches found for "${searchTerm}".`;
            if (interaction.isMessageComponent()) {
                await interaction.editReply({ content, components: [] });
            }
            else {
                await safeReply(interaction, {
                    content,
                    flags: MessageFlags.Ephemeral,
                });
            }
            return;
        }
        const opts = igdbSearch.results.map((game) => {
            const year = game.first_release_date
                ? new Date(game.first_release_date * 1000).getFullYear()
                : "TBD";
            return {
                id: game.id,
                label: `${game.name} (${year})`,
                description: (game.summary || "No summary").slice(0, 95),
            };
        });
        const { components } = createIgdbSession(interaction.user.id, opts, async (sel, gameId) => {
            if (!sel.deferred && !sel.replied) {
                await sel.deferUpdate().catch(() => { });
            }
            await sel.editReply({
                content: "Importing game details from IGDB...",
                components: [],
            }).catch(() => { });
            const imported = await this.importGameFromIgdbForCompletion(gameId);
            await saveCompletion(sel, ctx.targetUserId, imported.gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, null, imported.title, ctx.announce, true);
        });
        const content = `No GameDB match; select an IGDB result to import for "${searchTerm}".`;
        if (interaction.isMessageComponent()) {
            await interaction.editReply({
                content: "Found results on IGDB. See message below.",
                components: [],
            });
            await interaction.followUp({ content, components, flags: MessageFlags.Ephemeral });
        }
        else {
            await safeReply(interaction, {
                content,
                components,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async processCompletionSelection(interaction, value, ctx) {
        if (value === "import-igdb") {
            if (!ctx.query) {
                await interaction.reply({
                    content: "Original search query lost. Please try again.",
                    flags: MessageFlags.Ephemeral,
                });
                return false;
            }
            await this.promptIgdbSelection(interaction, ctx.query, ctx);
            return true;
        }
        try {
            const parsedId = Number(value);
            if (!Number.isInteger(parsedId) || parsedId <= 0) {
                await interaction.followUp({
                    content: "Invalid selection.",
                    flags: MessageFlags.Ephemeral,
                });
                return false;
            }
            const game = await Game.getGameById(parsedId);
            if (!game) {
                await interaction.followUp({
                    content: "Selected game was not found in GameDB.",
                    flags: MessageFlags.Ephemeral,
                });
                return false;
            }
            await saveCompletion(interaction, ctx.targetUserId, game.id, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, null, game.title, ctx.announce, true);
            return true;
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.followUp({
                content: `Failed to add completion: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
            return false;
        }
    }
    async importGameFromIgdbForCompletion(igdbId) {
        const existing = await Game.getGameByIgdbId(igdbId);
        if (existing) {
            return { gameId: existing.id, title: existing.title };
        }
        const details = await igdbService.getGameDetails(igdbId);
        if (!details) {
            throw new Error("Failed to load game details from IGDB.");
        }
        let imageData = null;
        if (details.cover?.image_id) {
            try {
                const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
                const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
                imageData = Buffer.from(imageResponse.data);
            }
            catch (err) {
                console.error("Failed to download cover image:", err);
            }
        }
        const newGame = await Game.createGame(details.name, details.summary ?? "", imageData, details.id, details.slug ?? null, details.total_rating ?? null, details.url ?? null);
        await Game.saveFullGameMetadata(newGame.id, details);
        return { gameId: newGame.id, title: details.name };
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
            await setPresence(interaction, presenceText);
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
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand)
            return;
        const guild = interaction.guild;
        if (!guild) {
            await safeReply(interaction, { content: "This command must be run in a guild.", flags: MessageFlags.Ephemeral });
            return;
        }
        const roleMap = {
            admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
            newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
        };
        await safeReply(interaction, { content: "Fetching all guild members... this may take a moment.", flags: MessageFlags.Ephemeral });
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
            flags: MessageFlags.Ephemeral,
        });
    }
    async help(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const okToUseCommand = await isSuperAdmin(interaction);
        if (!okToUseCommand) {
            return;
        }
        const response = buildSuperAdminHelpResponse();
        await safeReply(interaction, {
            ...response,
            flags: MessageFlags.Ephemeral,
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
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
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
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const seeds = this.buildGamedbSeeds();
        const totalPending = seeds.length;
        const sessionSeeds = seeds.slice(0, GAMEDB_SESSION_LIMIT);
        if (!sessionSeeds.length) {
            await safeReply(interaction, {
                content: "No GOTM or NR-GOTM entries found to import.",
                flags: MessageFlags.Ephemeral,
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
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
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
                flags: MessageFlags.Ephemeral,
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
                flags: MessageFlags.Ephemeral,
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
            flags: MessageFlags.Ephemeral,
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
        let igdbMatches = [];
        try {
            const searchRes = await igdbService.searchGames(seed.title);
            igdbMatches = searchRes.results;
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
        if (igdbMatches.length === 1) {
            return this.importGameFromIgdb(igdbMatches[0].id, label, seed);
        }
        const options = igdbMatches.map((game) => {
            const year = game.first_release_date
                ? new Date(game.first_release_date * 1000).getFullYear()
                : "TBD";
            const rating = game.total_rating ? ` | ${Math.round(game.total_rating)}/100` : "";
            return {
                id: game.id,
                label: `${game.name} (${year})`.substring(0, 100),
                description: `${rating} ${game.summary ?? "No summary"}`.substring(0, 95),
            };
        });
        return await new Promise((resolve) => {
            const { components, sessionId } = createIgdbSession(interaction.user.id, options, async (sel, igdbId) => {
                const result = await this.importGameFromIgdb(igdbId, label, seed);
                deleteIgdbSession(sessionId);
                finish(result);
                try {
                    await sel.update({ content: result, components: [] });
                }
                catch {
                    // ignore
                }
            });
            const timeout = setTimeout(async () => {
                deleteIgdbSession(sessionId);
                finish(`[${label}] Skipped (no selection): ${seed.title}`);
                await safeReply(interaction, {
                    content: `[${label}] Import cancelled or timed out.`,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => { });
            }, 120000);
            const finish = (value) => {
                clearTimeout(timeout);
                resolve(value);
            };
            safeReply(interaction, {
                content: `Multiple IGDB matches for ${seed.source} Round ${seed.round} (${seed.monthYear}).`,
                components,
                __forceFollowUp: true,
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
                await safeReply(interaction, { embeds: [embed] });
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
    Slash({ description: "Add a game completion for another user", name: "completion-add-other" }),
    __param(0, SlashOption({
        description: "User to add completion for",
        name: "user",
        required: true,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashChoice(...COMPLETION_TYPES.map((t) => ({
        name: t,
        value: t,
    })))),
    __param(1, SlashOption({
        description: "Type of completion",
        name: "completion_type",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Search text to find/import the game",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Completion date (defaults to today)",
        name: "completion_date",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Final playtime in hours (e.g., 12.5)",
        name: "final_playtime_hours",
        required: false,
        type: ApplicationCommandOptionType.Number,
    })),
    __param(5, SlashOption({
        description: "Announce this completion in the completions channel?",
        name: "announce",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], SuperAdmin.prototype, "completionAddOther", null);
__decorate([
    SelectMenuComponent({ id: /^sa-comp-add-select:.+/ })
], SuperAdmin.prototype, "handleSuperAdminCompletionSelect", null);
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
        description: "Backfill thread/game links from GOTM / NR-GOTM data",
        name: "thread-game-link-backfill",
    })
], SuperAdmin.prototype, "threadGameLinkBackfill", null);
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
