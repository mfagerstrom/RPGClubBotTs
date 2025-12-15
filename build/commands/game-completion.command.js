var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, } from "discord.js";
import { Discord, Slash, SlashOption, SlashGroup, SelectMenuComponent, ButtonComponent, SlashChoice, } from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { createIgdbSession, } from "../services/IgdbSelectService.js";
import { COMPLETION_TYPES, COMPLETION_PAGE_SIZE, formatDiscordTimestamp, formatPlaytimeHours, parseCompletionDateInput, formatTableDate, buildGameDbThumbAttachment, applyGameDbThumbnail, } from "./profile.command.js";
const completionAddSessions = new Map();
let GameCompletionCommands = class GameCompletionCommands {
    async completionAdd(completionType, gameId, query, completionDate, finalPlaytimeHours, fromNowPlaying, interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
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
        const userId = interaction.user.id;
        if (fromNowPlaying) {
            const list = await Member.getNowPlayingEntries(userId);
            if (!list.length) {
                await safeReply(interaction, {
                    content: "Your Now Playing list is empty. Add a game first or use query/game_id.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const sessionId = this.createCompletionSession({
                userId,
                completionType,
                completedAt,
                finalPlaytimeHours: playtime,
                source: "existing",
            });
            const select = new StringSelectMenuBuilder()
                .setCustomId(`completion-add-select:${sessionId}`)
                .setPlaceholder("Select a game from Now Playing")
                .addOptions(list.slice(0, 25).map((entry) => ({
                label: entry.title.slice(0, 100),
                value: String(entry.gameId),
                description: `GameDB #${entry.gameId}`,
            })));
            await safeReply(interaction, {
                content: "Choose the game you just completed:",
                components: [new ActionRowBuilder().addComponents(select)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (gameId) {
            const game = await Game.getGameById(Number(gameId));
            if (!game) {
                await safeReply(interaction, {
                    content: `GameDB #${gameId} was not found.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await this.saveCompletion(interaction, userId, game.id, completionType, completedAt, playtime, game.title);
            return;
        }
        const searchTerm = (query ?? "").trim();
        if (!searchTerm) {
            await safeReply(interaction, {
                content: "Provide a game_id, set from_now_playing:true, or include a search query.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await this.promptCompletionSelection(interaction, searchTerm, {
            userId,
            completionType,
            completedAt,
            finalPlaytimeHours: playtime,
            source: "existing",
        });
    }
    async completionList(year, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        await this.renderCompletionPage(interaction, interaction.user.id, 0, year ?? null, ephemeral);
    }
    async completionEdit(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
        if (!completions.length) {
            await safeReply(interaction, {
                content: "You have no completions to edit.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const lines = completions.map((c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`);
        const buttons = completions.map((c, idx) => new ButtonBuilder()
            .setCustomId(`comp-edit:${interaction.user.id}:${c.completionId}`)
            .setLabel(emojis[idx])
            .setStyle(ButtonStyle.Primary));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        await safeReply(interaction, {
            content: "Select a completion to edit:",
            embeds: [new EmbedBuilder().setTitle("Your Completions").setDescription(lines.join("\n"))],
            components: rows,
            flags: MessageFlags.Ephemeral,
        });
    }
    async completionDelete(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const completions = await Member.getCompletions({ userId: interaction.user.id, limit: 10 });
        if (!completions.length) {
            await safeReply(interaction, {
                content: "You have no completions to delete.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const lines = completions.map((c, idx) => `${emojis[idx]} ${c.title} — ${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`);
        const buttons = completions.map((c, idx) => new ButtonBuilder()
            .setCustomId(`comp-del:${interaction.user.id}:${c.completionId}`)
            .setLabel(emojis[idx])
            .setStyle(ButtonStyle.Danger));
        const rows = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
        await safeReply(interaction, {
            content: "Select a completion to delete:",
            embeds: [new EmbedBuilder().setTitle("Your Completions").setDescription(lines.join("\n"))],
            components: rows,
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleCompletionAddSelect(interaction) {
        const [, sessionId] = interaction.customId.split(":");
        const ctx = completionAddSessions.get(sessionId);
        if (!ctx) {
            await interaction
                .reply({
                content: "This completion prompt has expired.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
        if (interaction.user.id !== ctx.userId) {
            await interaction
                .reply({
                content: "This completion prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            })
                .catch(() => { });
            return;
        }
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
            completionAddSessions.delete(sessionId);
            try {
                await interaction.editReply({ components: [] }).catch(() => { });
            }
            catch {
                // ignore
            }
        }
    }
    async handleCompletionDeleteButton(interaction) {
        const [, ownerId, completionIdRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This delete prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const completionId = Number(completionIdRaw);
        if (!Number.isInteger(completionId) || completionId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const ok = await Member.deleteCompletion(ownerId, completionId);
        if (!ok) {
            await interaction.reply({
                content: "Completion not found or could not be deleted.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.reply({
            content: `Deleted completion #${completionId}.`,
            flags: MessageFlags.Ephemeral,
        });
        try {
            await interaction.message.edit({ components: [] }).catch(() => { });
        }
        catch {
            // ignore
        }
    }
    async handleCompletionEditSelect(interaction) {
        const [, ownerId, completionIdRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This edit prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const completionId = Number(completionIdRaw);
        if (!Number.isInteger(completionId) || completionId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const completions = await Member.getCompletions({ userId: ownerId, limit: 25 });
        const completion = completions.find((c) => c.completionId === completionId);
        if (!completion) {
            await interaction.reply({
                content: "Completion not found.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const fieldButtons = [
            new ButtonBuilder()
                .setCustomId(`comp-edit-field:${ownerId}:${completionId}:type`)
                .setLabel("Completion Type")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`comp-edit-field:${ownerId}:${completionId}:date`)
                .setLabel("Completion Date")
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`comp-edit-field:${ownerId}:${completionId}:playtime`)
                .setLabel("Final Playtime")
                .setStyle(ButtonStyle.Secondary),
        ];
        await interaction.reply({
            content: `Editing **${completion.title}** — choose a field to update:`,
            embeds: [
                new EmbedBuilder().setDescription(`Current: ${completion.completionType} — ${completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date"}${completion.finalPlaytimeHours != null ? ` — ${formatPlaytimeHours(completion.finalPlaytimeHours)}` : ""}`),
            ],
            components: [new ActionRowBuilder().addComponents(fieldButtons)],
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleCompletionFieldEdit(interaction) {
        const [, ownerId, completionIdRaw, field] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This edit prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const completionId = Number(completionIdRaw);
        if (!Number.isInteger(completionId) || completionId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const prompt = field === "type"
            ? "Type the new completion type (Main Story | Main Story + Side Content | Completionist):"
            : field === "date"
                ? "Type the new completion date (e.g., 2025-12-11)."
                : "Type the new final playtime in hours (e.g., 42.5).";
        await interaction.reply({
            content: prompt,
            flags: MessageFlags.Ephemeral,
        });
        const channel = interaction.channel;
        if (!channel || !("awaitMessages" in channel)) {
            await interaction.followUp({
                content: "I couldn't listen for your response in this channel.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const collected = await channel
            .awaitMessages({
            filter: (m) => m.author.id === interaction.user.id,
            max: 1,
            time: 60_000,
        })
            .catch(() => null);
        const message = collected?.first();
        if (!message) {
            await interaction.followUp({
                content: "Timed out waiting for your response.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const value = message.content.trim();
        try {
            if (field === "type") {
                const normalized = COMPLETION_TYPES.find((t) => t.toLowerCase() === value.toLowerCase());
                if (!normalized) {
                    throw new Error("Invalid completion type.");
                }
                await Member.updateCompletion(ownerId, completionId, { completionType: normalized });
            }
            else if (field === "date") {
                const dt = parseCompletionDateInput(value);
                await Member.updateCompletion(ownerId, completionId, { completedAt: dt });
            }
            else if (field === "playtime") {
                const num = Number(value);
                if (Number.isNaN(num) || num < 0)
                    throw new Error("Playtime must be a non-negative number.");
                await Member.updateCompletion(ownerId, completionId, { finalPlaytimeHours: num });
            }
            await interaction.followUp({
                content: "Completion updated.",
                flags: MessageFlags.Ephemeral,
            });
        }
        catch (err) {
            await interaction.followUp({
                content: err?.message ?? "Failed to update completion.",
                flags: MessageFlags.Ephemeral,
            });
        }
        finally {
            try {
                await message.delete().catch(() => { });
            }
            catch {
                // ignore
            }
        }
    }
    async handleCompletionListPaging(interaction) {
        const [, ownerId, yearRaw, pageRaw, dir] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This list isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const page = Number(pageRaw);
        if (Number.isNaN(page))
            return;
        const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
        const year = yearRaw ? Number(yearRaw) : null;
        const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;
        try {
            await interaction.deferUpdate();
        }
        catch {
            // ignore
        }
        await this.renderCompletionPage(interaction, ownerId, nextPage, Number.isNaN(year ?? NaN) ? null : year, ephemeral);
    }
    createCompletionSession(ctx) {
        const sessionId = `comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        completionAddSessions.set(sessionId, ctx);
        return sessionId;
    }
    async renderCompletionPage(interaction, userId, page, year, ephemeral) {
        const total = await Member.countCompletions(userId, year);
        if (total === 0) {
            await safeReply(interaction, {
                content: year
                    ? `You have no recorded completions for ${year}.`
                    : "You have no recorded completions yet.",
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return;
        }
        const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
        const safePage = Math.min(Math.max(page, 0), totalPages - 1);
        const offset = safePage * COMPLETION_PAGE_SIZE;
        // Fetch all (up to 1000) to calculate year-based numbering correctly across pages
        const allCompletions = await Member.getCompletions({
            userId,
            limit: 1000,
            offset: 0,
            year,
        });
        // Sort: Years Descending, then Date Ascending within year
        allCompletions.sort((a, b) => {
            const dateA = a.completedAt ? a.completedAt.getTime() : 0;
            const dateB = b.completedAt ? b.completedAt.getTime() : 0;
            const yearA = a.completedAt ? a.completedAt.getFullYear() : 0;
            const yearB = b.completedAt ? b.completedAt.getFullYear() : 0;
            if (yearA !== yearB) {
                return yearB - yearA;
            }
            return dateA - dateB;
        });
        if (!allCompletions.length) {
            if (safePage > 0) {
                await this.renderCompletionPage(interaction, userId, 0, year, ephemeral);
                return;
            }
            await safeReply(interaction, {
                content: "You have no recorded completions yet.",
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return;
        }
        // Calculate year-based index for every completion
        const yearCounts = {};
        const yearIndices = new Map(); // completionId -> sequential index
        for (const c of allCompletions) {
            const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
            yearCounts[yr] = (yearCounts[yr] ?? 0) + 1;
            yearIndices.set(c.completionId, yearCounts[yr]);
        }
        // Slice for the requested page
        const pageCompletions = allCompletions.slice(offset, offset + COMPLETION_PAGE_SIZE);
        const dateWidth = 10; // MM/DD/YYYY
        // Determine max index width for padding
        const maxIndexLabelLength = String(Math.max(...pageCompletions.map((c) => yearIndices.get(c.completionId) ?? 0)))
            .length + 1; // +1 for dot
        const grouped = pageCompletions.reduce((acc, c) => {
            const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
            acc[yr] = acc[yr] || [];
            const yearIdx = yearIndices.get(c.completionId);
            const idxLabelRaw = `${yearIdx}.`;
            const idxLabel = idxLabelRaw.padStart(maxIndexLabelLength, " ");
            const formattedDate = formatTableDate(c.completedAt);
            const dateLabel = formattedDate.padStart(dateWidth, " ");
            const typeAbbrev = c.completionType === "Main Story"
                ? "M"
                : c.completionType === "Main Story + Side Content"
                    ? "M+S"
                    : "C";
            const idxBlock = `\`${idxLabel}\``;
            const dateBlock = `\`${dateLabel}\``;
            const line = `${idxBlock} ${dateBlock} **${c.title}** (${typeAbbrev})`;
            acc[yr].push(line);
            return acc;
        }, {});
        const authorName = interaction.user?.displayName ?? interaction.user?.username ?? "User";
        const authorIcon = interaction.user?.displayAvatarURL?.({
            size: 64,
            forceStatic: false,
        });
        const embed = new EmbedBuilder().setTitle(`${authorName}'s Completed Games (${total} total)`);
        embed.setAuthor({
            name: authorName,
            iconURL: authorIcon ?? undefined,
        });
        applyGameDbThumbnail(embed);
        const sortedYears = Object.keys(grouped).sort((a, b) => {
            if (a === "Unknown")
                return 1;
            if (b === "Unknown")
                return -1;
            return Number(b) - Number(a);
        });
        const addChunkedField = (yr, content, chunkIndex) => {
            const name = chunkIndex === 0 ? yr : "";
            embed.addFields({ name, value: content || "None", inline: false });
        };
        for (const yr of sortedYears) {
            const lines = grouped[yr];
            if (!lines || !lines.length) {
                addChunkedField(yr, "None", 0);
                continue;
            }
            let buffer = "";
            let chunkIndex = 0;
            const flush = () => {
                if (buffer) {
                    addChunkedField(yr, buffer, chunkIndex);
                    chunkIndex++;
                    buffer = "";
                }
            };
            for (const line of lines) {
                const next = buffer ? `${buffer}\n${line}` : line;
                if (next.length > 1000) {
                    flush();
                    buffer = line;
                }
                else {
                    buffer = next;
                }
            }
            flush();
        }
        const yearPart = year ? String(year) : "";
        const prev = new ButtonBuilder()
            .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:prev`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage <= 0);
        const next = new ButtonBuilder()
            .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:next`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(safePage >= totalPages - 1);
        const components = totalPages > 1 ? [new ActionRowBuilder().addComponents(prev, next)] : [];
        const footerLines = ["M = Main Story • M+S = Main Story + Side Content • C = Completionist"];
        if (totalPages > 1) {
            footerLines.push(`${total} results. Page ${safePage + 1} of ${totalPages}.`);
        }
        embed.setFooter({ text: footerLines.join("\n") });
        await safeReply(interaction, {
            embeds: [embed],
            files: [buildGameDbThumbAttachment()],
            components,
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
    }
    async promptCompletionSelection(interaction, searchTerm, ctx) {
        const localResults = await Game.searchGames(searchTerm);
        if (localResults.length) {
            const sessionId = this.createCompletionSession(ctx);
            const select = new StringSelectMenuBuilder()
                .setCustomId(`completion-add-select:${sessionId}`)
                .setPlaceholder("Select a game to log completion")
                .addOptions(localResults.slice(0, 25).map((game) => ({
                label: game.title.slice(0, 100),
                value: String(game.id),
                description: `GameDB #${game.id}`,
            })));
            await safeReply(interaction, {
                content: `Select the game for "${searchTerm}".`,
                components: [new ActionRowBuilder().addComponents(select)],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const igdbSearch = await igdbService.searchGames(searchTerm);
        if (!igdbSearch.results.length) {
            await safeReply(interaction, {
                content: `No GameDB or IGDB matches found for "${searchTerm}".`,
                flags: MessageFlags.Ephemeral,
            });
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
            const imported = await this.importGameFromIgdb(gameId);
            await this.saveCompletion(sel, ctx.userId, imported.gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, imported.title);
        });
        await safeReply(interaction, {
            content: `No GameDB match; select an IGDB result to import for "${searchTerm}".`,
            components,
            flags: MessageFlags.Ephemeral,
        });
    }
    async processCompletionSelection(interaction, value, ctx) {
        if (!interaction.deferred && !interaction.replied) {
            try {
                await interaction.deferUpdate();
            }
            catch {
                // ignore
            }
        }
        try {
            let gameId = null;
            let gameTitle = null;
            if (value.startsWith("igdb:")) {
                const igdbId = Number(value.split(":")[1]);
                if (!Number.isInteger(igdbId) || igdbId <= 0) {
                    await interaction.followUp({
                        content: "Invalid IGDB selection.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                const imported = await this.importGameFromIgdb(igdbId);
                gameId = imported.gameId;
                gameTitle = imported.title;
            }
            else {
                const parsedId = Number(value);
                if (!Number.isInteger(parsedId) || parsedId <= 0) {
                    await interaction.followUp({
                        content: "Invalid selection.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                const game = await Game.getGameById(parsedId);
                if (!game) {
                    await interaction.followUp({
                        content: "Selected game was not found in GameDB.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                gameId = game.id;
                gameTitle = game.title;
            }
            if (!gameId) {
                await interaction.followUp({
                    content: "Could not determine a game to log.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await this.saveCompletion(interaction, ctx.userId, gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, gameTitle ?? undefined);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.followUp({
                content: `Failed to add completion: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async importGameFromIgdb(igdbId) {
        const existing = await Game.getGameByIgdbId(igdbId);
        if (existing) {
            return { gameId: existing.id, title: existing.title };
        }
        const details = await igdbService.getGameDetails(igdbId);
        if (!details) {
            throw new Error("Failed to load game details from IGDB.");
        }
        const newGame = await Game.createGame(details.name, details.summary ?? "", null, details.id, details.slug ?? null, details.total_rating ?? null, details.url ?? null);
        await Game.saveFullGameMetadata(newGame.id, details);
        return { gameId: newGame.id, title: details.name };
    }
    async saveCompletion(interaction, userId, gameId, completionType, completedAt, finalPlaytimeHours, gameTitle) {
        if (interaction.user.id !== userId) {
            await interaction.followUp({
                content: "You can only log completions for yourself.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const game = await Game.getGameById(gameId);
        if (!game) {
            await interaction.followUp({
                content: `GameDB #${gameId} was not found.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        let completionId;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            completionId = await Member.addCompletion({
                userId,
                gameId,
                completionType,
                completedAt,
                finalPlaytimeHours,
            });
        }
        catch (err) {
            const msg = err?.message ?? "Failed to save completion.";
            await interaction.followUp({
                content: `Could not save completion: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            await Member.removeNowPlaying(userId, gameId);
        }
        catch {
            // Ignore cleanup errors
        }
        const dateText = completedAt ? formatDiscordTimestamp(completedAt) : "today";
        const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
        const details = [completionType, dateText, playtimeText].filter(Boolean).join(" — ");
        await interaction.followUp({
            content: `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
            flags: MessageFlags.Ephemeral,
        });
    }
};
__decorate([
    Slash({ description: "Add a game completion", name: "add" }),
    __param(0, SlashChoice(...COMPLETION_TYPES.map((t) => ({
        name: t,
        value: t,
    })))),
    __param(0, SlashOption({
        description: "Type of completion",
        name: "completion_type",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "GameDB id (optional if using query/from_now_playing)",
        name: "game_id",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(2, SlashOption({
        description: "Search text to find/import the game",
        name: "query",
        required: false,
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
        description: "Pick a game from your Now Playing list",
        name: "from_now_playing",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], GameCompletionCommands.prototype, "completionAdd", null);
__decorate([
    Slash({ description: "List your completed games", name: "list" }),
    __param(0, SlashOption({
        description: "Filter to a specific year (optional)",
        name: "year",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "If true, show in channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], GameCompletionCommands.prototype, "completionList", null);
__decorate([
    Slash({ description: "Edit one of your completion records", name: "edit" })
], GameCompletionCommands.prototype, "completionEdit", null);
__decorate([
    Slash({ description: "Delete one of your completion records", name: "delete" })
], GameCompletionCommands.prototype, "completionDelete", null);
__decorate([
    SelectMenuComponent({ id: /^completion-add-select:.+/ })
], GameCompletionCommands.prototype, "handleCompletionAddSelect", null);
__decorate([
    ButtonComponent({ id: /^comp-del:[^:]+:\d+$/ })
], GameCompletionCommands.prototype, "handleCompletionDeleteButton", null);
__decorate([
    ButtonComponent({ id: /^comp-edit:[^:]+:\d+$/ })
], GameCompletionCommands.prototype, "handleCompletionEditSelect", null);
__decorate([
    ButtonComponent({ id: /^comp-edit-field:[^:]+:\d+:(type|date|playtime)$/ })
], GameCompletionCommands.prototype, "handleCompletionFieldEdit", null);
__decorate([
    ButtonComponent({ id: /^comp-list-page:[^:]+:[^:]*:\d+:(prev|next)$/ })
], GameCompletionCommands.prototype, "handleCompletionListPaging", null);
GameCompletionCommands = __decorate([
    Discord(),
    SlashGroup({ description: "Manage game completions", name: "game-completion" }),
    SlashGroup("game-completion")
], GameCompletionCommands);
export { GameCompletionCommands };
