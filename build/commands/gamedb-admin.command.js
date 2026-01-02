var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption, } from "discordx";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import Game from "../classes/Game.js";
import { setThreadGameLink } from "../classes/Thread.js";
import axios from "axios";
import { readFileSync } from "fs";
import path from "path";
import { igdbService } from "../services/IgdbService.js";
const AUDIT_PAGE_SIZE = 20;
const AUDIT_SESSIONS = new Map();
const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(process.cwd(), "src", "assets", "images", GAME_DB_THUMB_NAME);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);
function buildGameDbThumbAttachment() {
    return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}
let GameDbAdmin = class GameDbAdmin {
    async audit(missingImages, missingThreads, autoAcceptImages, showInChat, interaction) {
        const isPublic = !!showInChat;
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        if (!(await isAdmin(interaction)))
            return;
        if (autoAcceptImages) {
            await this.runAutoAcceptImages(interaction, isPublic);
            return;
        }
        // Default to both if neither is specified, otherwise follow flags
        // If user says missing_images: true, missing_threads: false -> only images
        // If user says missing_images: true -> (missing_threads is undefined) -> treat undefined as false if one is set?
        // Let's stick to: if both undefined, check both. If one defined, follow it.
        let checkImages = true;
        let checkThreads = true;
        if (missingImages !== undefined || missingThreads !== undefined) {
            checkImages = !!missingImages;
            checkThreads = !!missingThreads;
        }
        if (!checkImages && !checkThreads) {
            await safeReply(interaction, {
                content: "You must check for at least one thing (images or threads).",
                flags: MessageFlags.Ephemeral, // Always ephemeral for errors/warnings? Or match showInChat? 
                // Typically warnings like this are okay to be ephemeral even if requested public, but let's stick to consistent visibility or force ephemeral for errors.
                // Actually, previous code forced ephemeral. Let's force ephemeral for validation errors to reduce spam.
            });
            return;
        }
        const games = await Game.getGamesForAudit(checkImages, checkThreads);
        if (games.length === 0) {
            await safeReply(interaction, {
                content: "No games found matching the audit criteria! Great job.",
                flags: isPublic ? undefined : MessageFlags.Ephemeral,
            });
            return;
        }
        const sessionId = interaction.id;
        AUDIT_SESSIONS.set(sessionId, {
            userId: interaction.user.id,
            games,
            page: 0,
            filter: checkImages && checkThreads ? "both" : checkImages ? "image" : "thread",
        });
        const response = this.buildAuditListResponse(sessionId);
        await safeReply(interaction, {
            ...response,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async handleAuditPage(interaction) {
        const parts = interaction.customId.split(":");
        const sessionId = parts[1];
        const direction = parts[2];
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session) {
            await safeUpdate(interaction, { content: "Session expired.", components: [] });
            return;
        }
        if (session.userId !== interaction.user.id)
            return;
        const totalPages = Math.ceil(session.games.length / AUDIT_PAGE_SIZE);
        if (direction === "next" && session.page < totalPages - 1) {
            session.page++;
        }
        else if (direction === "prev" && session.page > 0) {
            session.page--;
        }
        const response = this.buildAuditListResponse(sessionId);
        await safeUpdate(interaction, response);
    }
    async handleAuditSelect(interaction) {
        const parts = interaction.customId.split(":");
        const sessionId = parts[1];
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session) {
            await safeUpdate(interaction, { content: "Session expired.", components: [] });
            return;
        }
        if (session.userId !== interaction.user.id)
            return;
        const gameId = Number(interaction.values[0]);
        const game = session.games.find((g) => g.id === gameId);
        if (!game) {
            await safeUpdate(interaction, { content: "Game not found in session." });
            return;
        }
        const response = await this.buildAuditDetailResponse(sessionId, game);
        await safeUpdate(interaction, response);
    }
    async handleAuditBack(interaction) {
        const sessionId = interaction.customId.split(":")[1];
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session) {
            await safeUpdate(interaction, { content: "Session expired.", components: [] });
            return;
        }
        const response = this.buildAuditListResponse(sessionId);
        await safeUpdate(interaction, response);
    }
    async handleAuditAcceptIgdb(interaction) {
        const [, sessionId, gameIdStr] = interaction.customId.split(":");
        const gameId = Number(gameIdStr);
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session || session.userId !== interaction.user.id)
            return;
        const game = session.games.find(g => g.id === gameId);
        if (!game || !game.igdbId) {
            await safeReply(interaction, { content: "Invalid game or missing IGDB ID.", flags: MessageFlags.Ephemeral });
            return;
        }
        await safeReply(interaction, { content: "Fetching image from IGDB...", flags: MessageFlags.Ephemeral });
        try {
            const details = await igdbService.getGameDetails(game.igdbId);
            if (!details || !details.cover?.image_id) {
                await safeReply(interaction, { content: "Failed to find cover image on IGDB.", flags: MessageFlags.Ephemeral });
                return;
            }
            const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
            const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
            const buffer = Buffer.from(resp.data);
            await Game.updateGameImage(gameId, buffer);
            // Update session data
            if (game) {
                game.imageData = buffer;
            }
            await safeReply(interaction, { content: "IGDB Image accepted and saved!", flags: MessageFlags.Ephemeral });
        }
        catch (err) {
            await safeReply(interaction, { content: `Error fetching IGDB image: ${err.message}`, flags: MessageFlags.Ephemeral });
        }
    }
    async handleAuditImage(interaction) {
        const [, sessionId, gameIdStr] = interaction.customId.split(":");
        const gameId = Number(gameIdStr);
        // We need to use a collector in the channel to get the image
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session || session.userId !== interaction.user.id)
            return;
        await safeReply(interaction, {
            content: "Please upload an image (or paste a URL) for this game in the chat.",
            flags: MessageFlags.Ephemeral
        });
        const channel = interaction.channel;
        if (!channel)
            return;
        try {
            const collected = await channel.awaitMessages({
                filter: (m) => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.length > 0),
                max: 1,
                time: 60000,
                errors: ["time"],
            });
            const msg = collected.first();
            if (!msg)
                return;
            let imageUrl = "";
            if (msg.attachments.size > 0) {
                imageUrl = msg.attachments.first()?.url ?? "";
            }
            else {
                imageUrl = msg.content.trim();
            }
            // Validate URL roughly
            if (!imageUrl.startsWith("http")) {
                await safeReply(interaction, { content: "Invalid image URL/attachment.", flags: MessageFlags.Ephemeral });
                return;
            }
            await safeReply(interaction, { content: "Processing image...", flags: MessageFlags.Ephemeral });
            try {
                const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
                const buffer = Buffer.from(resp.data);
                await Game.updateGameImage(gameId, buffer);
                await msg.delete().catch(() => { });
                // Update session data locally so UI reflects change if we go back/refresh
                const game = session.games.find(g => g.id === gameId);
                if (game) {
                    game.imageData = buffer;
                }
                await safeReply(interaction, { content: "Image updated successfully!", flags: MessageFlags.Ephemeral });
                // Refresh detail view
                // We can't easily "edit" the previous interaction message from here without the interaction object flow
                // But the user can click "Back" or re-select to see changes, or we could update the message if we had access.
                // Since this is a new reply, let's just let them know.
            }
            catch (err) {
                await safeReply(interaction, { content: `Failed to update image: ${err.message}`, flags: MessageFlags.Ephemeral });
            }
        }
        catch {
            await safeReply(interaction, { content: "Timed out waiting for image.", flags: MessageFlags.Ephemeral });
        }
    }
    async handleAuditThread(interaction) {
        const [, sessionId, gameIdStr] = interaction.customId.split(":");
        const gameId = Number(gameIdStr);
        const session = AUDIT_SESSIONS.get(sessionId);
        if (!session || session.userId !== interaction.user.id)
            return;
        await safeReply(interaction, {
            content: "Please mention the thread (e.g. <#123456>) or paste the Thread ID to link.",
            flags: MessageFlags.Ephemeral
        });
        const channel = interaction.channel;
        if (!channel)
            return;
        try {
            const collected = await channel.awaitMessages({
                filter: (m) => m.author.id === interaction.user.id,
                max: 1,
                time: 60000,
                errors: ["time"],
            });
            const msg = collected.first();
            if (!msg)
                return;
            const content = msg.content.trim();
            // Extract ID from mention or raw string
            const threadId = content.replace(/<#(\d+)>/, "");
            if (!/^\d+$/.test(threadId)) {
                await safeReply(interaction, { content: "Invalid Thread ID.", flags: MessageFlags.Ephemeral });
                return;
            }
            await safeReply(interaction, { content: "Linking thread...", flags: MessageFlags.Ephemeral });
            try {
                await setThreadGameLink(threadId, gameId);
                await msg.delete().catch(() => { });
                await safeReply(interaction, { content: "Thread linked successfully!", flags: MessageFlags.Ephemeral });
                // Remove from session list if checking threads? 
                // Or just let it be. simpler to leave it.
            }
            catch (err) {
                await safeReply(interaction, { content: `Failed to link thread: ${err.message}`, flags: MessageFlags.Ephemeral });
            }
        }
        catch {
            await safeReply(interaction, { content: "Timed out waiting for thread ID.", flags: MessageFlags.Ephemeral });
        }
    }
    buildAuditListResponse(sessionId) {
        const session = AUDIT_SESSIONS.get(sessionId);
        const { games, page } = session;
        const totalPages = Math.ceil(games.length / AUDIT_PAGE_SIZE);
        const start = page * AUDIT_PAGE_SIZE;
        const end = start + AUDIT_PAGE_SIZE;
        const slice = games.slice(start, end);
        const embed = new EmbedBuilder()
            .setTitle(`GameDB Audit (${session.filter})`)
            .setDescription(`Showing items ${start + 1}-${Math.min(end, games.length)} of ${games.length}\n\n` +
            slice.map(g => `• **${g.title}** (ID: ${g.id}) ${!g.imageData ? "❌Img" : "✅Img"}`).join("\n"))
            .setFooter({ text: `Page ${page + 1}/${totalPages}` });
        const select = new StringSelectMenuBuilder()
            .setCustomId(`audit-select:${sessionId}`)
            .setPlaceholder("Select a game to audit")
            .addOptions(slice.map(g => ({
            label: g.title.substring(0, 100),
            value: String(g.id),
            description: `ID: ${g.id}`,
        })));
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`audit-page:${sessionId}:prev`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0), new ButtonBuilder()
            .setCustomId(`audit-page:${sessionId}:next`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1));
        const row = new ActionRowBuilder().addComponents(select);
        return {
            embeds: [embed],
            components: [row, buttons],
            files: []
        };
    }
    async buildAuditDetailResponse(sessionId, game) {
        const embed = new EmbedBuilder()
            .setTitle(`Audit: ${game.title}`)
            .setDescription(`Game ID: ${game.id}\nIGDB ID: ${game.igdbId ?? "N/A"}`)
            .setColor(0xFFA500); // Orange for audit
        const files = [buildGameDbThumbAttachment()];
        embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
        let igdbImageAvailable = false;
        let igdbImageUrl = "";
        // Check IGDB for image if missing
        if (!game.imageData && game.igdbId) {
            try {
                const details = await igdbService.getGameDetails(game.igdbId);
                if (details?.cover?.image_id) {
                    igdbImageAvailable = true;
                    igdbImageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
                    embed.addFields({ name: "IGDB Suggestion", value: "[Link to Image](" + igdbImageUrl + ")", inline: true });
                }
            }
            catch {
                // ignore
            }
        }
        if (game.imageData) {
            embed.addFields({ name: "Image", value: "✅ Present", inline: true });
            // Optionally show it
            const attach = new AttachmentBuilder(game.imageData, { name: "cover.jpg" });
            files.push(attach);
            embed.setImage("attachment://cover.jpg");
        }
        else {
            embed.addFields({ name: "Image", value: "❌ Missing", inline: true });
        }
        // Check thread link
        const associations = await Game.getGameAssociations(game.id);
        const nowPlaying = await Game.getNowPlayingMembers(game.id); // Also checks for thread links in its query
        // Find any thread
        const threadId = associations.gotmWins.find(w => w.threadId)?.threadId ??
            associations.nrGotmWins.find(w => w.threadId)?.threadId ??
            nowPlaying.find(p => p.threadId)?.threadId;
        if (threadId) {
            embed.addFields({ name: "Thread", value: `✅ <#${threadId}>`, inline: true });
        }
        else {
            embed.addFields({ name: "Thread", value: "❌ Missing", inline: true });
        }
        const actionRow = new ActionRowBuilder();
        actionRow.addComponents(new ButtonBuilder()
            .setCustomId(`audit-back:${sessionId}`)
            .setLabel("Back to List")
            .setStyle(ButtonStyle.Secondary));
        if (!game.imageData && igdbImageAvailable) {
            actionRow.addComponents(new ButtonBuilder()
                .setCustomId(`audit-accept-igdb:${sessionId}:${game.id}`)
                .setLabel("Accept IGDB Image")
                .setStyle(ButtonStyle.Success));
        }
        actionRow.addComponents(new ButtonBuilder()
            .setCustomId(`audit-img:${sessionId}:${game.id}`)
            .setLabel("Upload Image")
            .setStyle(ButtonStyle.Primary), new ButtonBuilder()
            .setCustomId(`audit-thread:${sessionId}:${game.id}`)
            .setLabel("Link Thread")
            .setStyle(ButtonStyle.Success));
        return {
            embeds: [embed],
            components: [actionRow],
            files
        };
    }
    async runAutoAcceptImages(interaction, isPublic) {
        const games = await Game.getGamesForAudit(true, false);
        const candidates = games.filter(g => !g.imageData && g.igdbId);
        if (candidates.length === 0) {
            await safeReply(interaction, {
                content: "No games found with missing images and valid IGDB IDs.",
                flags: isPublic ? undefined : MessageFlags.Ephemeral,
            });
            return;
        }
        const embed = new EmbedBuilder()
            .setTitle("Auto-Accept IGDB Images")
            .setDescription(`Found ${candidates.length} candidate(s). Starting process...`)
            .setColor(0x0099ff);
        await safeReply(interaction, {
            embeds: [embed],
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
        let logHistory = "";
        const updateEmbed = async (log) => {
            if (log) {
                logHistory = (logHistory + "\n" + log).trim();
                // Truncate from the beginning if too long
                if (logHistory.length > 3500) {
                    logHistory = "..." + logHistory.slice(logHistory.length - 3500);
                }
            }
            embed.setDescription(logHistory || "Processing...");
            try {
                await interaction.editReply({ embeds: [embed] });
            }
            catch {
                // ignore
            }
        };
        let success = 0;
        let skipped = 0;
        let failed = 0;
        for (const game of candidates) {
            try {
                if (!game.igdbId) {
                    skipped++;
                    continue;
                }
                const details = await igdbService.getGameDetails(game.igdbId);
                if (!details || !details.cover?.image_id) {
                    skipped++;
                    await updateEmbed(`⏭️ Skipped **${game.title}** (No IGDB cover found)`);
                    continue;
                }
                const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
                const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
                const buffer = Buffer.from(resp.data);
                await Game.updateGameImage(game.id, buffer);
                success++;
                await updateEmbed(`✅ Updated **${game.title}**`);
            }
            catch (err) {
                failed++;
                await updateEmbed(`❌ Failed **${game.title}**: ${err.message}`);
            }
            // Delay to respect rate limits and allow reading
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const summary = `\n**Run Complete**\n✅ Updated: ${success}\n⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
        await updateEmbed(summary);
        embed.setColor(0x2ecc71);
        await interaction.editReply({ embeds: [embed] });
    }
};
__decorate([
    Slash({ description: "Audit GameDB for missing images or threads (Admin only)", name: "audit" }),
    __param(0, SlashOption({
        description: "Filter for missing images",
        name: "missing_images",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Filter for missing thread links",
        name: "missing_threads",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(2, SlashOption({
        description: "Automatically accept IGDB images for all missing ones",
        name: "auto_accept_images",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(3, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], GameDbAdmin.prototype, "audit", null);
__decorate([
    ButtonComponent({ id: /^audit-page:[^:]+:(next|prev)$/ })
], GameDbAdmin.prototype, "handleAuditPage", null);
__decorate([
    SelectMenuComponent({ id: /^audit-select:[^:]+$/ })
], GameDbAdmin.prototype, "handleAuditSelect", null);
__decorate([
    ButtonComponent({ id: /^audit-back:[^:]+$/ })
], GameDbAdmin.prototype, "handleAuditBack", null);
__decorate([
    ButtonComponent({ id: /^audit-accept-igdb:[^:]+:\d+$/ })
], GameDbAdmin.prototype, "handleAuditAcceptIgdb", null);
__decorate([
    ButtonComponent({ id: /^audit-img:[^:]+:\d+$/ })
], GameDbAdmin.prototype, "handleAuditImage", null);
__decorate([
    ButtonComponent({ id: /^audit-thread:[^:]+:\d+$/ })
], GameDbAdmin.prototype, "handleAuditThread", null);
GameDbAdmin = __decorate([
    Discord(),
    SlashGroup({ description: "Game Database Commands", name: "gamedb" }),
    SlashGroup("gamedb")
], GameDbAdmin);
export { GameDbAdmin };
