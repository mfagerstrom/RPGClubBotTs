var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, escapeCodeBlock, MessageFlags, } from "discord.js";
import { readFileSync } from "fs";
import path from "path";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption, } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game from "../classes/Game.js";
import axios from "axios"; // For downloading image attachments
import { igdbService } from "../services/IgdbService.js";
import { createIgdbSession, } from "../services/IgdbSelectService.js";
import Member from "../classes/Member.js";
import { COMPLETION_TYPES, parseCompletionDateInput, } from "./profile.command.js";
const GAME_SEARCH_PAGE_SIZE = 25;
const GAME_SEARCH_SESSIONS = new Map();
function isUniqueConstraintError(err) {
    const msg = err?.message ?? "";
    return /ORA-00001/i.test(msg) || /unique constraint/i.test(msg);
}
function isUnknownWebhookError(err) {
    const code = err?.code ?? err?.rawError?.code;
    return code === 10015;
}
const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(process.cwd(), "src", "assets", "images", GAME_DB_THUMB_NAME);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);
const MAX_COMPLETION_NOTE_LEN = 500;
const MAX_NOW_PLAYING_NOTE_LEN = 500;
function buildGameDbThumbAttachment() {
    return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}
function applyGameDbThumbnail(embed) {
    return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}
let GameDb = class GameDb {
    async add(title, igdbId, bulkTitles, includeRaw, interaction) {
        await safeDeferReply(interaction);
        if (igdbId) {
            await this.addGameToDatabase(interaction, Number(igdbId), { selectionMessage: null });
            return;
        }
        const parsedBulk = bulkTitles?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
        const singleTitle = title?.trim() ?? "";
        const allTitles = (singleTitle ? [singleTitle] : []).concat(parsedBulk).filter(Boolean);
        if (!allTitles.length) {
            await safeReply(interaction, {
                content: "Provide a title or up to 5 comma-separated titles.",
            });
            return;
        }
        if (allTitles.length > 5) {
            await safeReply(interaction, {
                content: "Bulk import supports up to 5 titles at a time.",
            });
            return;
        }
        for (const t of allTitles) {
            await this.processTitle(interaction, t, includeRaw ?? false);
        }
    }
    async handleNoResults(interaction, query) {
        try {
            // If something was added concurrently, surface nearby matches while prompting IGDB import.
            const existing = await Game.searchGames(query);
            const existingList = existing
                .slice(0, 10)
                .map((g) => `• **${g.title}** (GameDB #${g.id})`);
            const existingText = existingList.length
                ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
                : null;
            const searchRes = await igdbService.searchGames(query);
            const results = searchRes.results;
            if (!results.length) {
                await safeReply(interaction, {
                    content: existingText
                        ? `No games found on IGDB matching "${query}".\nSimilar GameDB entries:\n${existingText}`
                        : `No games found on IGDB matching "${query}".`,
                    __forceFollowUp: true,
                });
                return;
            }
            if (results.length === 1) {
                await this.addGameToDatabase(interaction, results[0].id, { selectionMessage: null });
                return;
            }
            const opts = results.map((game) => {
                const year = game.first_release_date
                    ? new Date(game.first_release_date * 1000).getFullYear()
                    : "TBD";
                return {
                    id: game.id,
                    label: `${game.name} (${year})`,
                    description: (game.summary || "No summary").substring(0, 95),
                };
            });
            const { components } = createIgdbSession(interaction.user.id, opts, async (sel, igdbId) => {
                if (!sel.deferred && !sel.replied) {
                    await sel.deferUpdate().catch(() => { });
                }
                await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message });
            });
            const totalLabel = typeof searchRes.total === "number" ? searchRes.total : results.length;
            const needsPaging = totalLabel > 22;
            const pagingHint = needsPaging
                ? "\nUse the dropdown's Next page option to see more results."
                : "";
            const embed = new EmbedBuilder().setDescription(`Found ${totalLabel} results for "${query}". Showing first ${Math.min(results.length, 22)}.${pagingHint ? ` ${pagingHint}` : ""}`);
            if (existingText) {
                embed.addFields({
                    name: "Existing GameDB matches",
                    value: existingText.slice(0, 1024),
                });
            }
            await safeReply(interaction, {
                embeds: [embed],
                components,
                __forceFollowUp: true,
            });
        }
        catch (err) {
            await safeReply(interaction, {
                content: `Auto-import failed: ${err?.message ?? err}`,
                __forceFollowUp: true,
            });
        }
    }
    async igdbApiDump(title, interaction) {
        await safeDeferReply(interaction);
        try {
            const searchRes = await igdbService.searchGames(title, 50, true);
            const results = searchRes.results;
            if (!results?.length) {
                await safeReply(interaction, {
                    content: `No IGDB results for "${title}".`,
                    __forceFollowUp: true,
                });
                return;
            }
            const json = JSON.stringify(results, null, 2);
            const sanitized = escapeCodeBlock ? escapeCodeBlock(json) : json;
            const attachment = new AttachmentBuilder(Buffer.from(json, "utf8"), {
                name: "igdb-response.json",
            });
            const maxPreview = 1500;
            const preview = sanitized.length > maxPreview ? `${sanitized.slice(0, maxPreview)}...\n(truncated)` : sanitized;
            await safeReply(interaction, {
                content: `Found ${results.length} IGDB result(s) for "${title}".\n` +
                    `\`\`\`json\n${preview}\n\`\`\`\nFull array attached as igdb-response.json.`,
                files: [attachment],
                __forceFollowUp: true,
            });
        }
        catch (err) {
            await safeReply(interaction, {
                content: `Failed to fetch IGDB data: ${err?.message ?? err}`,
                __forceFollowUp: true,
            });
        }
    }
    async processTitle(interaction, title, includeRaw = false) {
        try {
            // 1. Search IGDB
            const searchRes = includeRaw
                ? await igdbService.searchGames(title, undefined, true)
                : await igdbService.searchGames(title);
            const results = searchRes.results;
            if (!results || results.length === 0) {
                await this.handleNoResults(interaction, title);
                return;
            }
            // 1b. Single Result - Auto Add
            if (results.length === 1) {
                await this.addGameToDatabase(interaction, results[0].id, { selectionMessage: null });
                return;
            }
            // 2. Build Select Menu
            const opts = results.map((game) => {
                const year = game.first_release_date
                    ? new Date(game.first_release_date * 1000).getFullYear()
                    : "TBD";
                return {
                    id: game.id,
                    label: `${game.name} (${year})`,
                    description: (game.summary || "No summary").substring(0, 95),
                };
            });
            const attachment = includeRaw && searchRes.raw
                ? new AttachmentBuilder(Buffer.from(JSON.stringify(searchRes.raw, null, 2), "utf8"), {
                    name: "igdb-search.json",
                })
                : null;
            const { components } = createIgdbSession(interaction.user.id, opts, async (sel, igdbId) => {
                if (!sel.deferred && !sel.replied) {
                    await sel.deferUpdate().catch(() => { });
                }
                await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message });
            });
            await safeReply(interaction, {
                content: `Found ${results.length} results for "${title}". Please select one:`,
                components,
                files: attachment ? [attachment] : undefined,
                __forceFollowUp: true,
            });
        }
        catch (error) {
            await safeReply(interaction, {
                content: `Failed to search IGDB. Error: ${error.message}`,
            });
        }
    }
    async addGameToDatabase(interaction, igdbId, opts) {
        // 4. Fetch Details
        const details = await igdbService.getGameDetails(igdbId);
        if (!details) {
            // followUp for components, editReply for command interactions.
            const msg = "Failed to fetch details from IGDB.";
            const payload = { content: msg };
            try {
                if (interaction.isMessageComponent()) {
                    await interaction.followUp(payload);
                }
                else {
                    await interaction.editReply(payload);
                }
            }
            catch (err) {
                if (isUnknownWebhookError(err)) {
                    await safeReply(interaction, { ...payload, __forceFollowUp: true });
                }
                else {
                    throw err;
                }
            }
            return;
        }
        // 5. Download Image
        let imageData = null;
        if (details.cover?.image_id) {
            try {
                const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
                const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
                imageData = Buffer.from(imageResponse.data);
            }
            catch (err) {
                console.error("Failed to download cover image:", err);
                // Proceed without image
            }
        }
        // 6. Save to DB
        const igdbUrl = details.url
            || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
        let newGame;
        try {
            newGame = await Game.createGame(details.name, details.summary || null, imageData, details.id, details.slug, details.total_rating ?? null, igdbUrl);
        }
        catch (err) {
            if (isUniqueConstraintError(err)) {
                const msg = "This game has already been imported.";
                const payload = { content: msg };
                try {
                    if (interaction.isMessageComponent()) {
                        await interaction.followUp(payload);
                    }
                    else {
                        await interaction.editReply(payload);
                    }
                }
                catch (e) {
                    if (isUnknownWebhookError(e)) {
                        await safeReply(interaction, { ...payload, __forceFollowUp: true });
                    }
                    else {
                        throw e;
                    }
                }
                return;
            }
            throw err;
        }
        // 6a. Save Extended Metadata
        await Game.saveFullGameMetadata(newGame.id, details);
        // 6b. Process Releases
        await this.processReleaseDates(newGame.id, details.release_dates || [], details.platforms || []);
        // Clean up selection menu if present
        if (opts?.selectionMessage) {
            try {
                await opts.selectionMessage.edit({ components: [] });
            }
            catch {
                // ignore cleanup failures
            }
        }
        // 7. Final Success Message with embed left in chat
        const embed = new EmbedBuilder()
            .setTitle(`Added to GameDB: ${newGame.title}`)
            .setDescription(`GameDB ID: ${newGame.id}${igdbUrl ? `\nIGDB: ${igdbUrl}` : ""}`)
            .setColor(0x0099ff);
        applyGameDbThumbnail(embed);
        const attachments = [buildGameDbThumbAttachment()];
        if (imageData) {
            embed.setImage("attachment://cover.jpg");
            attachments.push(new AttachmentBuilder(imageData, { name: "cover.jpg" }));
        }
        await safeReply(interaction, {
            content: `Successfully added **${newGame.title}** (ID: ${newGame.id}) to the database!`,
            embeds: [embed],
            files: attachments,
            __forceFollowUp: true,
        });
    }
    async view(gameId, query, interaction) {
        await safeDeferReply(interaction);
        if (Number.isFinite(gameId)) {
            await this.showGameProfile(interaction, gameId);
            return;
        }
        const searchTerm = (query ?? "").trim();
        if (!searchTerm) {
            await safeReply(interaction, {
                content: "Provide a game_id or a search query.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await this.runSearchFlow(interaction, searchTerm);
    }
    async showGameProfile(interaction, gameId) {
        const profile = await this.buildGameProfile(gameId, interaction);
        if (!profile) {
            await safeReply(interaction, {
                content: `No game found with ID ${gameId}.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const includeActions = !("isMessageComponent" in interaction) ||
            !interaction.isMessageComponent();
        const components = includeActions ? [this.buildGameProfileActionRow(gameId)] : [];
        await safeReply(interaction, {
            embeds: profile.embeds,
            files: profile.files,
            components: components.length ? components : undefined,
        });
    }
    async buildGameProfile(gameId, interaction) {
        try {
            const game = await Game.getGameById(gameId);
            if (!game) {
                return null;
            }
            const releases = await Game.getGameReleases(gameId);
            const platforms = await Game.getAllPlatforms();
            const regions = await Game.getAllRegions();
            const associations = await Game.getGameAssociations(gameId);
            const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
            const completions = await Game.getGameCompletions(gameId);
            const platformMap = new Map(platforms.map((p) => [p.id, p.name]));
            const regionMap = new Map(regions.map((r) => [r.id, r.name]));
            const description = game.description || "No description available.";
            const embed = new EmbedBuilder()
                .setTitle(`${game.title} (GameDB #${game.id})`)
                .setColor(0x0099ff);
            if (game.igdbUrl) {
                embed.setURL(game.igdbUrl);
            }
            applyGameDbThumbnail(embed);
            // Keep the win/round info up top in the single embed
            if (associations.gotmWins.length) {
                const lines = associations.gotmWins.map((win) => `Round ${win.round}`);
                embed.addFields({ name: "GOTM Round(s)", value: lines.join("\n"), inline: true });
            }
            if (associations.nrGotmWins.length) {
                const lines = associations.nrGotmWins.map((win) => `Round ${win.round}`);
                embed.addFields({ name: "NR-GOTM Round(s)", value: lines.join("\n"), inline: true });
            }
            // Thread / Reddit links as their own fields
            const threadId = associations.gotmWins.find((w) => w.threadId)?.threadId ??
                associations.nrGotmWins.find((w) => w.threadId)?.threadId ??
                nowPlayingMembers.find((p) => p.threadId)?.threadId ??
                null;
            if (threadId) {
                const threadLabel = await this.buildThreadLink(threadId, interaction?.guildId ?? null, interaction?.client);
                embed.addFields({
                    name: "Game Discussion Thread",
                    value: threadLabel ?? `[Thread Link](https://discord.com/channels/@me/${threadId})`,
                    inline: true,
                });
            }
            const redditUrlRaw = associations.gotmWins.find((w) => w.redditUrl)?.redditUrl ??
                associations.nrGotmWins.find((w) => w.redditUrl)?.redditUrl ??
                null;
            const redditUrl = redditUrlRaw === "__NO_VALUE__" ? null : redditUrlRaw;
            if (redditUrl) {
                embed.addFields({
                    name: "Reddit Discussion Thread",
                    value: `[Reddit Link](${redditUrl})`,
                    inline: true,
                });
            }
            if (nowPlayingMembers.length) {
                const MAX_NOW_PLAYING_DISPLAY = 12;
                const lines = nowPlayingMembers.slice(0, MAX_NOW_PLAYING_DISPLAY).map((member) => {
                    const name = member.globalName ?? member.username ?? member.userId;
                    return `${name} (<@${member.userId}>)`;
                });
                if (nowPlayingMembers.length > MAX_NOW_PLAYING_DISPLAY) {
                    const remaining = nowPlayingMembers.length - MAX_NOW_PLAYING_DISPLAY;
                    lines.push(`…and ${remaining} more playing now.`);
                }
                embed.addFields({
                    name: "Now Playing",
                    value: lines.join("\n"),
                    inline: true,
                });
            }
            if (completions.length) {
                const MAX_COMPLETIONS_DISPLAY = 12;
                const lines = completions.slice(0, MAX_COMPLETIONS_DISPLAY).map((member) => {
                    const name = member.globalName ?? member.username ?? member.userId;
                    return `${name} (<@${member.userId}>) — ${member.completionType}`;
                });
                if (completions.length > MAX_COMPLETIONS_DISPLAY) {
                    const remaining = completions.length - MAX_COMPLETIONS_DISPLAY;
                    lines.push(`…and ${remaining} more completed this.`);
                }
                embed.addFields({
                    name: "Completed By",
                    value: lines.join("\n"),
                    inline: true,
                });
            }
            // Remaining association info (nominations) goes here before description
            this.appendAssociationFields(embed, {
                ...associations,
                gotmWins: [],
                nrGotmWins: [],
            });
            // Description comes after rounds/links/nominations to keep those at the top
            const descChunks = this.chunkText(description, 1024);
            descChunks.forEach((chunk, idx) => {
                embed.addFields({
                    name: idx === 0 ? "Description" : `Description (cont. ${idx + 1})`,
                    value: chunk,
                    inline: false,
                });
            });
            if (releases.length > 0) {
                const releaseField = releases
                    .map((r) => {
                    const platformName = platformMap.get(r.platformId) || "Unknown Platform";
                    const regionName = regionMap.get(r.regionId) || "Unknown Region";
                    const releaseDate = r.releaseDate ? r.releaseDate.toLocaleDateString() : "TBD";
                    const format = r.format ? `(${r.format})` : "";
                    return `• **${platformName}** (${regionName}) ${format} - ${releaseDate}`;
                })
                    .join("\n");
                embed.addFields({ name: "Releases", value: releaseField, inline: false });
            }
            const developers = await Game.getGameDevelopers(gameId);
            if (developers.length) {
                embed.addFields({ name: "Developers", value: developers.join(", "), inline: true });
            }
            const publishers = await Game.getGamePublishers(gameId);
            if (publishers.length) {
                embed.addFields({ name: "Publishers", value: publishers.join(", "), inline: true });
            }
            const genres = await Game.getGameGenres(gameId);
            if (genres.length) {
                embed.addFields({ name: "Genres", value: genres.join(", "), inline: true });
            }
            const themes = await Game.getGameThemes(gameId);
            if (themes.length) {
                embed.addFields({ name: "Themes", value: themes.join(", "), inline: true });
            }
            const modes = await Game.getGameModes(gameId);
            if (modes.length) {
                embed.addFields({ name: "Game Modes", value: modes.join(", "), inline: true });
            }
            const perspectives = await Game.getGamePerspectives(gameId);
            if (perspectives.length) {
                embed.addFields({
                    name: "Player Perspectives",
                    value: perspectives.join(", "),
                    inline: true,
                });
            }
            const engines = await Game.getGameEngines(gameId);
            if (engines.length) {
                embed.addFields({ name: "Game Engines", value: engines.join(", "), inline: true });
            }
            const franchises = await Game.getGameFranchises(gameId);
            if (franchises.length) {
                embed.addFields({ name: "Franchises", value: franchises.join(", "), inline: true });
            }
            const series = await Game.getGameSeries(gameId);
            if (series) {
                embed.addFields({ name: "Series / Collection", value: series, inline: true });
            }
            if (game.totalRating) {
                embed.addFields({
                    name: "IGDB Rating",
                    value: `${Math.round(game.totalRating)}/100`,
                    inline: true,
                });
            }
            const files = [buildGameDbThumbAttachment()];
            if (game.imageData) {
                files.push(new AttachmentBuilder(game.imageData, { name: "game_image.png" }));
            }
            return { embeds: [embed], files };
        }
        catch (error) {
            console.error("Failed to build game profile:", error);
            return null;
        }
    }
    chunkText(text, size) {
        if (!text)
            return ["No description available."];
        const chunks = [];
        for (let i = 0; i < text.length; i += size) {
            chunks.push(text.slice(i, i + size));
        }
        return chunks;
    }
    async buildThreadLink(threadId, guildId, client) {
        if (!client || !guildId) {
            return null;
        }
        try {
            const channel = await client.channels.fetch(threadId);
            const name = channel?.name || "Thread Link";
            return `[${name}](https://discord.com/channels/${guildId}/${threadId})`;
        }
        catch {
            return null;
        }
    }
    buildGameProfileActionRow(gameId) {
        const addNowPlaying = new ButtonBuilder()
            .setCustomId(`gamedb-action:nowplaying:${gameId}`)
            .setLabel("Add to Now Playing List")
            .setStyle(ButtonStyle.Primary);
        const addCompletion = new ButtonBuilder()
            .setCustomId(`gamedb-action:completion:${gameId}`)
            .setLabel("Add Completion")
            .setStyle(ButtonStyle.Success);
        return new ActionRowBuilder().addComponents(addNowPlaying, addCompletion);
    }
    async handleGameDbAction(interaction) {
        const [, action, gameIdRaw] = interaction.customId.split(":");
        const gameId = Number(gameIdRaw);
        if (!Number.isInteger(gameId) || gameId <= 0) {
            await interaction.reply({
                content: "Invalid GameDB id.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        const game = await Game.getGameById(gameId);
        if (!game) {
            await interaction.editReply({
                content: `No game found with ID ${gameId}.`,
                embeds: [],
                components: [],
            }).catch(() => { });
            return;
        }
        if (action === "nowplaying") {
            await this.runNowPlayingWizard(interaction, gameId, game.title);
            return;
        }
        await this.runCompletionWizard(interaction, gameId, game.title);
    }
    async runNowPlayingWizard(interaction, gameId, gameTitle) {
        const baseEmbed = this.getWizardBaseEmbed(interaction, "Now Playing Wizard");
        let logHistory = "";
        const updateEmbed = async (log) => {
            if (log) {
                logHistory += `${log}\n`;
            }
            if (logHistory.length > 3500) {
                logHistory = "..." + logHistory.slice(logHistory.length - 3500);
            }
            const embed = this.buildWizardEmbed(baseEmbed, logHistory || "Processing...");
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => { });
        };
        const wizardPrompt = async (question) => {
            await updateEmbed(`\n❓ **${question}**`);
            const channel = interaction.channel;
            if (!channel || typeof channel.awaitMessages !== "function") {
                await updateEmbed("❌ Cannot prompt for input in this channel.");
                return null;
            }
            const collected = await channel.awaitMessages({
                filter: (m) => m.author.id === interaction.user.id,
                max: 1,
                time: 120_000,
            }).catch(() => null);
            const first = collected?.first();
            if (!first) {
                await updateEmbed("❌ Timed out.");
                return null;
            }
            const content = first.content.trim();
            await first.delete().catch(() => { });
            await updateEmbed(`> *${content}*`);
            if (/^cancel$/i.test(content)) {
                await updateEmbed("❌ Cancelled by user.");
                return null;
            }
            return content;
        };
        await updateEmbed(`✅ Starting for **${gameTitle}**`);
        let note = null;
        while (true) {
            const response = await wizardPrompt("Optional note? Type it, or reply `skip` to leave blank.");
            if (response === null)
                return;
            if (/^skip$/i.test(response)) {
                note = null;
                break;
            }
            if (response.length > MAX_NOW_PLAYING_NOTE_LEN) {
                await updateEmbed(`❌ Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`);
                continue;
            }
            note = response;
            break;
        }
        try {
            await Member.addNowPlaying(interaction.user.id, gameId, note);
            await updateEmbed(`✅ Added **${gameTitle}** to your Now Playing list.`);
        }
        catch (err) {
            await updateEmbed(`❌ Failed to add: ${err?.message ?? String(err)}`);
        }
    }
    async runCompletionWizard(interaction, gameId, gameTitle) {
        const baseEmbed = this.getWizardBaseEmbed(interaction, "Completion Wizard");
        let logHistory = "";
        const updateEmbed = async (log) => {
            if (log) {
                logHistory += `${log}\n`;
            }
            if (logHistory.length > 3500) {
                logHistory = "..." + logHistory.slice(logHistory.length - 3500);
            }
            const embed = this.buildWizardEmbed(baseEmbed, logHistory || "Processing...");
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => { });
        };
        const wizardPrompt = async (question) => {
            await updateEmbed(`\n❓ **${question}**`);
            const channel = interaction.channel;
            if (!channel || typeof channel.awaitMessages !== "function") {
                await updateEmbed("❌ Cannot prompt for input in this channel.");
                return null;
            }
            const collected = await channel.awaitMessages({
                filter: (m) => m.author.id === interaction.user.id,
                max: 1,
                time: 120_000,
            }).catch(() => null);
            const first = collected?.first();
            if (!first) {
                await updateEmbed("❌ Timed out.");
                return null;
            }
            const content = first.content.trim();
            await first.delete().catch(() => { });
            await updateEmbed(`> *${content}*`);
            if (/^cancel$/i.test(content)) {
                await updateEmbed("❌ Cancelled by user.");
                return null;
            }
            return content;
        };
        await updateEmbed(`✅ Starting for **${gameTitle}**`);
        let completionType = null;
        while (true) {
            const response = await wizardPrompt(`Completion type? (${COMPLETION_TYPES.join(" / ")})`);
            if (response === null)
                return;
            const normalized = COMPLETION_TYPES.find((t) => t.toLowerCase() === response.toLowerCase());
            if (!normalized) {
                await updateEmbed("❌ Invalid completion type.");
                continue;
            }
            completionType = normalized;
            break;
        }
        let completedAt = null;
        while (true) {
            const response = await wizardPrompt("Completion date? (YYYY-MM-DD, `unknown`, or `today`)");
            if (response === null)
                return;
            if (/^unknown$/i.test(response)) {
                completedAt = null;
                break;
            }
            if (/^today$/i.test(response)) {
                completedAt = new Date();
                break;
            }
            try {
                completedAt = parseCompletionDateInput(response);
                break;
            }
            catch (err) {
                await updateEmbed(`❌ ${err?.message ?? "Invalid date."}`);
            }
        }
        let playtime = null;
        while (true) {
            const response = await wizardPrompt("Final playtime in hours? (e.g., 42.5, or `skip`)");
            if (response === null)
                return;
            if (/^skip$/i.test(response)) {
                playtime = null;
                break;
            }
            const num = Number(response);
            if (Number.isNaN(num) || num < 0) {
                await updateEmbed("❌ Playtime must be a non-negative number.");
                continue;
            }
            playtime = num;
            break;
        }
        let note = null;
        while (true) {
            const response = await wizardPrompt("Optional note? Type it, or reply `skip` to leave blank.");
            if (response === null)
                return;
            if (/^skip$/i.test(response)) {
                note = null;
                break;
            }
            if (response.length > MAX_COMPLETION_NOTE_LEN) {
                await updateEmbed(`❌ Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`);
                continue;
            }
            note = response;
            break;
        }
        try {
            await Member.addCompletion({
                userId: interaction.user.id,
                gameId,
                completionType: completionType ?? "Main Story",
                completedAt,
                finalPlaytimeHours: playtime,
                note,
            });
            await Member.removeNowPlaying(interaction.user.id, gameId).catch(() => { });
            await updateEmbed(`✅ Added completion for **${gameTitle}**.`);
        }
        catch (err) {
            await updateEmbed(`❌ Failed to add completion: ${err?.message ?? String(err)}`);
        }
    }
    getWizardBaseEmbed(interaction, fallbackTitle) {
        const existing = interaction.message?.embeds?.[0];
        if (existing) {
            return EmbedBuilder.from(existing);
        }
        return new EmbedBuilder().setTitle(fallbackTitle).setColor(0x0099ff);
    }
    buildWizardEmbed(base, log) {
        const embed = EmbedBuilder.from(base);
        const baseDesc = base.data.description ?? "";
        const divider = baseDesc ? "\n\n" : "";
        const combined = `${baseDesc}${divider}${log}`.trim();
        embed.setDescription(combined.slice(0, 4096));
        return embed;
    }
    // Helper to process release dates
    async processReleaseDates(gameId, releaseDates, platforms) {
        if (!releaseDates || !Array.isArray(releaseDates)) {
            return;
        }
        for (const release of releaseDates) {
            const platformId = typeof release.platform === "number"
                ? release.platform
                : (release.platform?.id ?? null);
            const platformName = typeof release.platform === "object"
                ? (release.platform?.name ?? null)
                : (platforms.find((p) => p.id === platformId)?.name ?? null);
            if (!platformId || !release.region) {
                continue;
            }
            const platform = await Game.ensurePlatform({ id: platformId, name: platformName });
            const region = await Game.ensureRegion(release.region);
            if (!platform || !region) {
                continue;
            }
            try {
                await Game.addReleaseInfo(gameId, platform.id, region.id, "Physical", release.date ? new Date(release.date * 1000) : null, null);
            }
            catch (err) {
                console.error(`Failed to add release for game ${gameId}:`, err);
            }
        }
    }
    appendAssociationFields(embed, assoc) {
        if (assoc.gotmWins.length) {
            const lines = assoc.gotmWins.map((win) => {
                const thread = win.threadId ? ` — Thread: <#${win.threadId}>` : "";
                const reddit = win.redditUrl ? ` — [Reddit](${win.redditUrl})` : "";
                return `Round ${win.round}${thread}${reddit}`;
            });
            embed.addFields({ name: "GOTM Round(s)", value: lines.join("\n"), inline: true });
        }
        if (assoc.nrGotmWins.length) {
            const lines = assoc.nrGotmWins.map((win) => {
                const thread = win.threadId ? ` — Thread: <#${win.threadId}>` : "";
                const reddit = win.redditUrl ? ` — [Reddit](${win.redditUrl})` : "";
                return `Round ${win.round}${thread}${reddit}`;
            });
            embed.addFields({ name: "NR-GOTM Round(s)", value: lines.join("\n"), inline: true });
        }
        if (assoc.gotmNominations.length) {
            const lines = assoc.gotmNominations.map((nom) => `Round ${nom.round} — ${nom.username} (<@${nom.userId}>)`);
            embed.addFields({ name: "GOTM Nominations", value: lines.join("\n"), inline: true });
        }
        if (assoc.nrGotmNominations.length) {
            const lines = assoc.nrGotmNominations.map((nom) => `Round ${nom.round} — ${nom.username} (<@${nom.userId}>)`);
            embed.addFields({ name: "NR-GOTM Nominations", value: lines.join("\n"), inline: true });
        }
    }
    async search(query, interaction) {
        await safeDeferReply(interaction);
        try {
            const searchTerm = (query ?? "").trim();
            await this.runSearchFlow(interaction, searchTerm, query);
        }
        catch (error) {
            await safeReply(interaction, {
                content: `Failed to search games. Error: ${error.message}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async runSearchFlow(interaction, searchTerm, rawQuery) {
        const results = await Game.searchGames(searchTerm);
        if (results.length === 0) {
            await this.handleNoResults(interaction, searchTerm || rawQuery || "Unknown");
            return;
        }
        if (results.length === 1) {
            await this.showGameProfile(interaction, results[0].id);
            return;
        }
        const sessionId = interaction.id;
        GAME_SEARCH_SESSIONS.set(sessionId, {
            userId: interaction.user.id,
            results,
            query: searchTerm,
        });
        const response = this.buildSearchResponse(sessionId, GAME_SEARCH_SESSIONS.get(sessionId), 0);
        await safeReply(interaction, response);
    }
    async handleSearchSelect(interaction) {
        const parts = interaction.customId.split(":");
        const sessionId = parts[1];
        const ownerId = parts[2];
        const page = Number(parts[3]);
        if (interaction.user.id !== ownerId) {
            await interaction
                .reply({
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const session = GAME_SEARCH_SESSIONS.get(sessionId);
        if (!session) {
            await interaction
                .reply({
                content: "This search session has expired.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const gameId = Number(interaction.values?.[0]);
        if (!Number.isFinite(gameId)) {
            await interaction
                .reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        const profile = await this.buildGameProfile(gameId, interaction);
        if (!profile) {
            await interaction
                .followUp({
                content: "Unable to load that game.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const response = this.buildSearchResponse(sessionId, session, page);
        const actionRow = this.buildGameProfileActionRow(gameId);
        try {
            await interaction.editReply({
                embeds: profile.embeds,
                files: profile.files,
                components: [actionRow, ...response.components],
                content: null,
            });
        }
        catch {
            // ignore update failures
        }
    }
    async handleSearchPage(interaction) {
        const parts = interaction.customId.split(":");
        const sessionId = parts[1];
        const ownerId = parts[2];
        const page = Number(parts[3]);
        const direction = parts[4];
        if (interaction.user.id !== ownerId) {
            await interaction
                .reply({
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const session = GAME_SEARCH_SESSIONS.get(sessionId);
        if (!session) {
            await interaction
                .reply({
                content: "This search session has expired.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        const totalPages = Math.max(1, Math.ceil(session.results.length / GAME_SEARCH_PAGE_SIZE));
        const delta = direction === "next" ? 1 : -1;
        const newPage = Math.min(Math.max(page + delta, 0), totalPages - 1);
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        const response = this.buildSearchResponse(sessionId, session, newPage);
        try {
            await interaction.editReply({
                ...response,
                files: response.files,
                content: null,
            });
        }
        catch {
            // ignore
        }
    }
    buildSearchResponse(sessionId, session, page) {
        const totalPages = Math.max(1, Math.ceil(session.results.length / GAME_SEARCH_PAGE_SIZE));
        const safePage = Math.min(Math.max(page, 0), totalPages - 1);
        const start = safePage * GAME_SEARCH_PAGE_SIZE;
        const displayedResults = session.results.slice(start, start + GAME_SEARCH_PAGE_SIZE);
        const resultList = displayedResults.map((g) => `• **${g.title}**`).join("\n");
        const title = session.query
            ? `Search Results for "${session.query}" (Page ${safePage + 1}/${totalPages})`
            : `All Games (Page ${safePage + 1}/${totalPages})`;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(resultList || "No results.")
            .setFooter({
            text: `${session.results.length} results total`,
        });
        applyGameDbThumbnail(embed);
        const selectCustomId = `gamedb-search-select:${sessionId}:${session.userId}:${safePage}`;
        const options = displayedResults.map((g) => ({
            label: g.title.substring(0, 100),
            value: String(g.id),
            description: "View this game",
        }));
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(selectCustomId)
            .setPlaceholder("Select a game to view details")
            .addOptions(options);
        const selectRow = new ActionRowBuilder().addComponents(selectMenu);
        const prevDisabled = safePage === 0;
        const nextDisabled = safePage >= totalPages - 1;
        const prevButton = new ButtonBuilder()
            .setCustomId(`gamedb-search-page:${sessionId}:${session.userId}:${safePage}:prev`)
            .setLabel("Previous Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(prevDisabled);
        const nextButton = new ButtonBuilder()
            .setCustomId(`gamedb-search-page:${sessionId}:${session.userId}:${safePage}:next`)
            .setLabel("Next Page")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(nextDisabled);
        const buttonRow = new ActionRowBuilder().addComponents(prevButton, nextButton);
        const components = [selectRow];
        if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
            components.push(buttonRow);
        }
        return {
            embeds: [embed],
            components,
            files: [buildGameDbThumbAttachment()],
        };
    }
};
__decorate([
    Slash({ description: "Add a new game to the database (searches IGDB)", name: "add" }),
    __param(0, SlashOption({
        description: "Title of the game to search for",
        name: "title",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "IGDB id (skip search and import directly)",
        name: "igdb_id",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(2, SlashOption({
        description: "Comma-separated list of up to 5 titles to import",
        name: "bulk_titles",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Include raw IGDB search JSON attachment",
        name: "include_raw",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], GameDb.prototype, "add", null);
__decorate([
    Slash({ description: "Dump raw IGDB API data for a title", name: "igdb_api_dump" }),
    __param(0, SlashOption({
        description: "Title to query on IGDB",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], GameDb.prototype, "igdbApiDump", null);
__decorate([
    Slash({ description: "View details of a game", name: "view" }),
    __param(0, SlashOption({
        description: "ID of the game to view",
        name: "game_id",
        required: false,
        type: ApplicationCommandOptionType.Number,
    })),
    __param(1, SlashOption({
        description: "Search query (falls back to search flow if no ID provided)",
        name: "title",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], GameDb.prototype, "view", null);
__decorate([
    ButtonComponent({ id: /^gamedb-action:(nowplaying|completion):\d+$/ })
], GameDb.prototype, "handleGameDbAction", null);
__decorate([
    Slash({ description: "Search for a game", name: "search" }),
    __param(0, SlashOption({
        description: "Search query (game title). Leave empty to list all.",
        name: "title",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], GameDb.prototype, "search", null);
__decorate([
    SelectMenuComponent({ id: /^gamedb-search-select:[^:]+:\d+:\d+$/ })
], GameDb.prototype, "handleSearchSelect", null);
__decorate([
    ButtonComponent({ id: /^gamedb-search-page:[^:]+:\d+:\d+:(next|prev)$/ })
], GameDb.prototype, "handleSearchPage", null);
GameDb = __decorate([
    Discord(),
    SlashGroup({ description: "Game Database Commands", name: "gamedb" }),
    SlashGroup("gamedb")
], GameDb);
export { GameDb };
