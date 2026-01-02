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
import { Discord, Slash, SlashOption, SlashGroup, SlashChoice, SelectMenuComponent, ButtonComponent, } from "discordx";
import Member from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import { createIgdbSession, } from "../services/IgdbSelectService.js";
import { saveCompletion } from "../functions/CompletionHelpers.js";
import { COMPLETION_TYPES, parseCompletionDateInput, } from "../commands/profile.command.js";
const MAX_NOW_PLAYING = 10;
const nowPlayingAddSessions = new Map();
const nowPlayingCompleteSessions = new Map();
function formatEntry(entry, guildId) {
    if (entry.threadId && guildId) {
        return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
    }
    return entry.title;
}
function chunkLines(lines, maxLength = 3800) {
    const chunks = [];
    let current = "";
    for (const line of lines) {
        const next = current.length ? `${current}\n${line}` : line;
        if (next.length > maxLength && current.length > 0) {
            chunks.push(current);
            current = line;
            continue;
        }
        current = next;
    }
    if (current.length) {
        chunks.push(current);
    }
    return chunks;
}
let NowPlayingCommand = class NowPlayingCommand {
    async nowPlaying(member, showAll, interaction) {
        const showAllFlag = showAll === true;
        const target = member ?? interaction.user;
        const ephemeral = !showAllFlag;
        await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        if (showAllFlag) {
            await this.showEveryone(interaction, ephemeral);
            return;
        }
        await this.showSingle(interaction, target, ephemeral);
    }
    async addNowPlaying(query, interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        try {
            const results = await Game.searchGames(query);
            const sessionId = `np-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            nowPlayingAddSessions.set(sessionId, { userId: interaction.user.id, query });
            const options = results.slice(0, 23).map((g) => ({
                label: g.title.substring(0, 100),
                value: String(g.id),
                description: `GameDB #${g.id}`,
            }));
            options.push({
                label: "Import another game from IGDB",
                value: "import-igdb",
                description: "Search IGDB and import a new GameDB entry",
            });
            const selectId = `nowplaying-add-select:${sessionId}`;
            const selectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(selectId)
                .setPlaceholder("Select the game to add")
                .addOptions(options));
            await safeReply(interaction, {
                content: "Select the game to add to your Now Playing list:",
                components: [selectRow],
                flags: MessageFlags.Ephemeral,
            });
            setTimeout(async () => {
                try {
                    const reply = (await interaction.fetchReply());
                    const hasActiveComponents = reply.components.some((row) => {
                        if (!("components" in row))
                            return false;
                        const actionRow = row;
                        return actionRow.components.length > 0;
                    });
                    if (!hasActiveComponents)
                        return;
                    await interaction.editReply({
                        content: "Timed out waiting for a selection. No changes made.",
                        components: [],
                    });
                }
                catch {
                    // ignore
                }
            }, 60_000);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not add to Now Playing: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async handleAddNowPlayingSelect(interaction) {
        const [, sessionId] = interaction.customId.split(":");
        const session = nowPlayingAddSessions.get(sessionId);
        const ownerId = session?.userId;
        if (!session || interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This add prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const choice = interaction.values[0];
        if (choice === "import-igdb") {
            await this.startNowPlayingIgdbImport(interaction, session);
            return;
        }
        if (choice === "no-results") {
            await interaction.update({
                content: "No GameDB results. Please try a different search or import from IGDB.",
                components: [],
            });
            return;
        }
        const gameId = Number(choice);
        if (!Number.isInteger(gameId) || gameId <= 0) {
            await interaction.update({
                content: "Invalid selection. Please try again.",
                components: [],
            });
            return;
        }
        try {
            const game = await Game.getGameById(gameId);
            if (!game) {
                await interaction.update({
                    content: "Selected game not found. Please try again.",
                    components: [],
                });
                return;
            }
            await Member.addNowPlaying(ownerId, gameId);
            const list = await Member.getNowPlaying(ownerId);
            await interaction.update({
                content: `Added **${game.title}** to your Now Playing list (${list.length}/${MAX_NOW_PLAYING}).`,
                components: [],
            });
            nowPlayingAddSessions.delete(sessionId);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.update({
                content: `Could not add to Now Playing: ${msg}`,
                components: [],
            });
        }
    }
    async removeNowPlaying(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        try {
            const current = await Member.getNowPlayingEntries(interaction.user.id);
            if (!current.length) {
                await safeReply(interaction, {
                    content: "Your Now Playing list is empty.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
            const lines = current.slice(0, emojis.length).map((entry, idx) => `${emojis[idx]} ${entry.title} (GameDB #${entry.gameId})`);
            const buttons = current.slice(0, emojis.length).map((entry, idx) => new ButtonBuilder()
                .setCustomId(`np-remove:${interaction.user.id}:${entry.gameId}`)
                .setLabel(`${idx + 1}`)
                .setStyle(ButtonStyle.Primary));
            const rows = [];
            for (let i = 0; i < buttons.length; i += 5) {
                rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
            }
            await safeReply(interaction, {
                content: "Select a game to remove from your Now Playing list:",
                embeds: [
                    new EmbedBuilder()
                        .setTitle("Now Playing")
                        .setDescription(lines.join("\n")),
                ],
                components: rows,
                flags: MessageFlags.Ephemeral,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not remove from Now Playing: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async completeGame(completionType, completionDate, finalPlaytimeHours, announce, interaction) {
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
        const userId = interaction.user.id;
        const list = await Member.getNowPlayingEntries(userId);
        if (!list.length) {
            await safeReply(interaction, {
                content: "Your Now Playing list is empty. Add a game first.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const sessionId = `np-comp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        nowPlayingCompleteSessions.set(sessionId, {
            userId,
            completionType,
            completedAt,
            finalPlaytimeHours: finalPlaytimeHours ?? null,
            announce,
        });
        const select = new StringSelectMenuBuilder()
            .setCustomId(`np-complete-select:${sessionId}`)
            .setPlaceholder("Select the game you completed")
            .addOptions(list.slice(0, 25).map((entry) => ({
            label: entry.title.slice(0, 100),
            value: String(entry.gameId),
            description: `GameDB #${entry.gameId}`,
        })));
        await safeReply(interaction, {
            content: "Choose the game from your Now Playing list to mark as completed:",
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleCompleteGameSelect(interaction) {
        const [, sessionId] = interaction.customId.split(":");
        const ctx = nowPlayingCompleteSessions.get(sessionId);
        if (!ctx) {
            await interaction.reply({
                content: "This completion prompt has expired.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        if (interaction.user.id !== ctx.userId) {
            await interaction.reply({
                content: "This prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const value = interaction.values?.[0];
        const gameId = Number(value);
        if (!Number.isInteger(gameId) || gameId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferUpdate();
            }
            const game = await Game.getGameById(gameId);
            await saveCompletion(interaction, ctx.userId, gameId, ctx.completionType, ctx.completedAt, ctx.finalPlaytimeHours, game?.title, ctx.announce);
            await interaction.editReply({ components: [] });
        }
        finally {
            nowPlayingCompleteSessions.delete(sessionId);
        }
    }
    async handleRemoveNowPlayingButton(interaction) {
        const [, ownerId, gameIdRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This remove prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const gameId = Number(gameIdRaw);
        if (!Number.isInteger(gameId) || gameId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            const removed = await Member.removeNowPlaying(ownerId, gameId);
            if (!removed) {
                await interaction.reply({
                    content: "Failed to remove that game (it may have been removed already).",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const list = await Member.getNowPlaying(ownerId);
            await interaction.reply({
                content: `Removed GameDB #${gameId} from your Now Playing list (${list.length}/${MAX_NOW_PLAYING}).`,
                flags: MessageFlags.Ephemeral,
            });
            try {
                await interaction.message.edit({ components: [] }).catch(() => { });
            }
            catch {
                // ignore
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await interaction.reply({
                content: `Could not remove from Now Playing: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async showSingle(interaction, target, ephemeral) {
        const entries = await Member.getNowPlaying(target.id);
        if (!entries.length) {
            await safeReply(interaction, {
                content: `No Now Playing entries found for <@${target.id}>.`,
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return;
        }
        let hasLinks = false;
        let hasUnlinked = false;
        const lines = entries.map((entry, idx) => {
            if (entry.threadId)
                hasLinks = true;
            else
                hasUnlinked = true;
            return `${idx + 1}. ${formatEntry(entry, interaction.guildId)}`;
        });
        const footerParts = [target.tag || target.username || target.id];
        if (hasLinks) {
            footerParts.push("Links on game titles lead to their respective discussion threads.");
        }
        if (hasUnlinked) {
            footerParts.push("For unlinked games, feel free to add a new thread or link one to the game if it already exists.");
        }
        const embed = new EmbedBuilder()
            .setTitle("Now Playing")
            .setDescription(lines.join("\n"))
            .setFooter({ text: footerParts.join("\n") });
        await safeReply(interaction, {
            content: `<@${target.id}>`,
            embeds: [embed],
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
    }
    async showEveryone(interaction, ephemeral) {
        const lists = await Member.getAllNowPlaying();
        if (!lists.length) {
            await safeReply(interaction, {
                content: "No Now Playing data found for anyone yet.",
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
            return;
        }
        let hasLinks = false;
        let hasUnlinked = false;
        const lines = lists.map((record, idx) => {
            const displayName = record.globalName ?? record.username ?? `Member ${idx + 1}`;
            const games = record.entries
                .map((entry) => {
                if (entry.threadId)
                    hasLinks = true;
                else
                    hasUnlinked = true;
                return formatEntry(entry, interaction.guildId);
            })
                .join("; ");
            return `${idx + 1}. <@${record.userId}> (${displayName}) - ${games}`;
        });
        const footerParts = [];
        if (hasLinks) {
            footerParts.push("Links on game titles lead to their respective discussion threads.");
        }
        if (hasUnlinked) {
            footerParts.push("For unlinked games, feel free to add a new thread or link one to the game if it already exists.");
        }
        const footerText = footerParts.join("\n");
        const chunks = chunkLines(lines);
        const embeds = chunks.slice(0, 10).map((chunk, idx) => new EmbedBuilder()
            .setTitle(idx === 0 ? "Now Playing - Everyone" : "Now Playing (continued)")
            .setDescription(chunk)
            .setFooter(footerText ? { text: footerText } : null));
        const truncated = chunks.length > embeds.length;
        await safeReply(interaction, {
            content: truncated
                ? "Showing the first set of results (truncated to Discord embed limits)."
                : undefined,
            embeds,
            flags: ephemeral ? MessageFlags.Ephemeral : undefined,
        });
    }
    async startNowPlayingIgdbImport(interaction, session) {
        try {
            const searchRes = await igdbService.searchGames(session.query);
            if (!searchRes.results.length) {
                await interaction.update({
                    content: `No IGDB results found for "${session.query}".`,
                    components: [],
                });
                return;
            }
            const opts = searchRes.results.map((game) => {
                const year = game.first_release_date
                    ? new Date(game.first_release_date * 1000).getFullYear()
                    : "TBD";
                return {
                    id: game.id,
                    label: `${game.name} (${year})`,
                    description: (game.summary || "No summary").slice(0, 95),
                };
            });
            const { components } = createIgdbSession(session.userId, opts, async (sel, igdbId) => {
                try {
                    const imported = await this.importGameFromIgdb(igdbId);
                    await Member.addNowPlaying(session.userId, imported.gameId);
                    const list = await Member.getNowPlaying(session.userId);
                    await sel.update({
                        content: `Imported **${imported.title}** and added to Now Playing (${list.length}/${MAX_NOW_PLAYING}).`,
                        components: [],
                    });
                }
                catch (err) {
                    const msg = err?.message ?? "Failed to import from IGDB.";
                    await sel.reply({
                        content: msg,
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => { });
                }
            });
            await interaction.update({
                content: "Select an IGDB result to import and add to Now Playing:",
                components,
            });
        }
        catch (err) {
            const msg = err?.message ?? "Failed to search IGDB.";
            await interaction.update({
                content: msg,
                components: [],
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
};
__decorate([
    Slash({ description: "Show now playing data", name: "list" }),
    __param(0, SlashOption({
        description: "Member to view; defaults to you.",
        name: "member",
        required: false,
        type: ApplicationCommandOptionType.User,
    })),
    __param(1, SlashOption({
        description: "Show everyone with Now Playing entries.",
        name: "all",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], NowPlayingCommand.prototype, "nowPlaying", null);
__decorate([
    Slash({ description: "Add a game to your Now Playing list", name: "add" }),
    __param(0, SlashOption({
        description: "Search text to find the game in GameDB",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], NowPlayingCommand.prototype, "addNowPlaying", null);
__decorate([
    SelectMenuComponent({ id: /^nowplaying-add-select:.+$/ })
], NowPlayingCommand.prototype, "handleAddNowPlayingSelect", null);
__decorate([
    Slash({ description: "Remove a game from your Now Playing list", name: "remove" })
], NowPlayingCommand.prototype, "removeNowPlaying", null);
__decorate([
    Slash({ description: "Log completion for a game in your Now Playing list", name: "complete-game" }),
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
        description: "Completion date (defaults to today)",
        name: "completion_date",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Final playtime in hours (e.g., 12.5)",
        name: "final_playtime_hours",
        required: false,
        type: ApplicationCommandOptionType.Number,
    })),
    __param(3, SlashOption({
        description: "Announce this completion in the completions channel?",
        name: "announce",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], NowPlayingCommand.prototype, "completeGame", null);
__decorate([
    SelectMenuComponent({ id: /^np-complete-select:.+$/ })
], NowPlayingCommand.prototype, "handleCompleteGameSelect", null);
__decorate([
    ButtonComponent({ id: /^np-remove:[^:]+:\d+$/ })
], NowPlayingCommand.prototype, "handleRemoveNowPlayingButton", null);
NowPlayingCommand = __decorate([
    Discord(),
    SlashGroup({ description: "Show now playing data", name: "now-playing" }),
    SlashGroup("now-playing")
], NowPlayingCommand);
export { NowPlayingCommand };
