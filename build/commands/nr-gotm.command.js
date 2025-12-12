var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder, MessageFlags } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { AUDIT_NO_VALUE_SENTINEL } from "./superadmin.command.js";
// Use relative import with .js for ts-node ESM compatibility
import NrGotm from "../classes/NrGotm.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { areNominationsClosed, getUpcomingNominationWindow, } from "../functions/NominationWindow.js";
import { deleteNominationForUser, getNominationForUser, listNominationsForRound, upsertNomination, } from "../classes/Nomination.js";
import { NR_GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { buildNrGotmHelpResponse } from "./help.command.js";
import { buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Game from "../classes/Game.js";
import { igdbService } from "../services/IgdbService.js";
import axios from "axios";
import { createIgdbSession, deleteIgdbSession, } from "../services/IgdbSelectService.js";
const ANNOUNCEMENTS_CHANNEL_ID = process.env.ANNOUNCEMENTS_CHANNEL_ID;
function isNoNrGotm(entry) {
    return entry.gameOfTheMonth.some((g) => (g.title ?? "").trim().toLowerCase() === "n/a");
}
const MONTH_CHOICES = [
    { name: "January", value: "January" },
    { name: "February", value: "February" },
    { name: "March", value: "March" },
    { name: "April", value: "April" },
    { name: "May", value: "May" },
    { name: "June", value: "June" },
    { name: "July", value: "July" },
    { name: "August", value: "August" },
    { name: "September", value: "September" },
    { name: "October", value: "October" },
    { name: "November", value: "November" },
    { name: "December", value: "December" },
];
const YEAR_CHOICES = (() => {
    try {
        const entries = NrGotm.all();
        const years = Array.from(new Set(entries
            .map((e) => {
            const m = e.monthYear.match(/(\d{4})$/);
            return m ? Number(m[1]) : null;
        })
            .filter((n) => n !== null))).sort((a, b) => b - a);
        return years.map((y) => ({ name: y.toString(), value: y }));
    }
    catch {
        return [];
    }
})();
let NrGotmSearch = class NrGotmSearch {
    async help(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const response = buildNrGotmHelpResponse();
        await safeReply(interaction, { ...response, ephemeral: true });
    }
    async search(round, year, month, title, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        let results = [];
        let criteriaLabel;
        try {
            if (round !== undefined && round !== null) {
                results = NrGotm.getByRound(Number(round));
                criteriaLabel = `Round ${round}`;
            }
            else if (title && title.trim().length > 0) {
                results = NrGotm.searchByTitle(title);
                criteriaLabel = `Title contains "${title}"`;
            }
            else if (year !== undefined && year !== null) {
                if (month && month.trim().length > 0) {
                    const monthValue = parseMonthValue(month);
                    results = NrGotm.getByYearMonth(Number(year), monthValue);
                    const monthLabel = typeof monthValue === "number" ? monthValue.toString() : monthValue;
                    criteriaLabel = `Year ${year}, Month ${monthLabel}`;
                }
                else {
                    results = NrGotm.getByYear(Number(year));
                    criteriaLabel = `Year ${year}`;
                }
            }
            else {
                const all = NrGotm.all();
                if (!all.length) {
                    await safeReply(interaction, {
                        content: "No NR-GOTM data available.",
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }
                const currentRound = Math.max(...all.map((e) => e.round));
                results = NrGotm.getByRound(currentRound);
            }
            if (!results || results.length === 0) {
                await safeReply(interaction, {
                    content: `No NR-GOTM entries found for ${criteriaLabel}.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const allEntries = NrGotm.all();
            const latestRound = allEntries.length ? Math.max(...allEntries.map((e) => e.round)) : null;
            const latestEntry = latestRound ? allEntries.find((e) => e.round === latestRound) : null;
            let embedsResults = results.slice();
            if (results.length === 1 &&
                latestEntry &&
                results[0].round === latestEntry.round &&
                isNoNrGotm(results[0])) {
                const previous = allEntries
                    .filter((e) => e.round !== latestEntry.round && !isNoNrGotm(e))
                    .sort((a, b) => b.round - a.round)[0];
                if (previous) {
                    embedsResults = [results[0], previous];
                    criteriaLabel = criteriaLabel ?? `Round ${results[0].round}`;
                }
            }
            const embedAssets = await buildNrGotmEmbeds(embedsResults, criteriaLabel, interaction.guildId ?? undefined, interaction.client);
            const content = criteriaLabel ? `Query: "${criteriaLabel}"` : undefined;
            if (embedAssets.length === 1) {
                const asset = embedAssets[0];
                const embedJson = asset.embed.toJSON();
                const thumbFromEmbed = embedJson.thumbnail?.url;
                const imageUrl = (asset.files && asset.files.length > 0
                    ? `attachment://${asset.files[0].name}`
                    : thumbFromEmbed) ?? undefined;
                asset.embed.setThumbnail(null);
                if (imageUrl) {
                    asset.embed.setImage(imageUrl);
                }
            }
            const sendGroup = async (group, first) => {
                const embeds = group.map((g) => g.embed);
                const files = group.flatMap((g) => g.files ?? []);
                const payload = {
                    content: first ? content : undefined,
                    embeds,
                    files: files.length ? files : undefined,
                    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
                };
                if (first) {
                    await safeReply(interaction, payload);
                }
                else {
                    await interaction.followUp(payload);
                }
            };
            if (embedAssets.length <= 10) {
                await sendGroup(embedAssets, true);
            }
            else {
                const chunks = chunkAssets(embedAssets, 10);
                await sendGroup(chunks[0], true);
                for (let i = 1; i < chunks.length; i++) {
                    await sendGroup(chunks[i], false);
                }
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error processing request: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async nominate(title, reason, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const cleanedTitle = title?.trim();
        if (!cleanedTitle) {
            await safeReply(interaction, {
                content: "Please provide a non-empty game title to nominate.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedReason = typeof reason === "string" ? reason.trim() : "";
        if (trimmedReason.length > 250) {
            await safeReply(interaction, {
                content: "Reason must be 250 characters or fewer.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        try {
            const window = await getUpcomingNominationWindow();
            if (areNominationsClosed(window)) {
                await safeReply(interaction, {
                    content: `Nominations for Round ${window.targetRound} are closed. ` +
                        `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const game = await resolveNrGameDbGame(interaction, cleanedTitle);
            if (!game)
                return;
            const userId = interaction.user.id;
            const existing = await getNominationForUser("nr-gotm", window.targetRound, userId);
            const saved = await upsertNomination("nr-gotm", window.targetRound, userId, game.id, trimmedReason || null);
            const replaced = existing && existing.gameTitle !== saved.gameTitle
                ? ` (replaced "${existing.gameTitle}")`
                : existing
                    ? " (no change to title)"
                    : "";
            await safeReply(interaction, {
                content: `${existing ? "Updated" : "Recorded"} your NR-GOTM nomination for Round ${window.targetRound}: "${saved.gameTitle}".${replaced}`,
                flags: MessageFlags.Ephemeral,
            });
            const nominations = await listNominationsForRound("nr-gotm", window.targetRound);
            const embed = buildNominationEmbed("NR-GOTM", "/nr-gotm nominate", window, nominations);
            const content = `<@${interaction.user.id}> nominated "${saved.gameTitle}" (GameDB #${game.id}) for NR-GOTM Round ${window.targetRound}.`;
            await announceNomination("NR-GOTM", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not save your nomination: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async deleteNomination(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        try {
            const window = await getUpcomingNominationWindow();
            if (areNominationsClosed(window)) {
                await safeReply(interaction, {
                    content: `Nominations for Round ${window.targetRound} are closed. ` +
                        `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const userId = interaction.user.id;
            const existing = await getNominationForUser("nr-gotm", window.targetRound, userId);
            if (!existing) {
                await safeReply(interaction, {
                    content: `You do not have an NR-GOTM nomination for Round ${window.targetRound}.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            await deleteNominationForUser("nr-gotm", window.targetRound, userId);
            const nominations = await listNominationsForRound("nr-gotm", window.targetRound);
            await safeReply(interaction, {
                content: `Deleted your NR-GOTM nomination for Round ${window.targetRound}: "${existing.gameTitle}".`,
                flags: MessageFlags.Ephemeral,
            });
            const embed = buildNominationEmbed("NR-GOTM", "/nr-gotm nominate", window, nominations);
            const content = `<@${interaction.user.id}> removed their NR-GOTM nomination "${existing.gameTitle}" for NR-GOTM Round ${window.targetRound}.`;
            await announceNomination("NR-GOTM", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not delete your nomination: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
    async listNominations(interaction) {
        await safeDeferReply(interaction);
        try {
            const window = await getUpcomingNominationWindow();
            const nominations = await listNominationsForRound("nr-gotm", window.targetRound);
            const embed = buildNominationEmbed("NR-GOTM", "/nr-gotm nominate", window, nominations);
            await safeReply(interaction, { embeds: [embed] });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not list nominations: ${msg}`,
            });
        }
    }
};
__decorate([
    Slash({
        description: "Show help for NR-GOTM commands",
        name: "help",
    })
], NrGotmSearch.prototype, "help", null);
__decorate([
    Slash({
        description: "Search Non-RPG Game of the Month (NR-GOTM)",
        name: "search",
    }),
    __param(0, SlashOption({
        description: "Round number (takes precedence if provided)",
        name: "round",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashChoice(...YEAR_CHOICES)),
    __param(1, SlashOption({
        description: "Year (e.g., 2023). Use with month for specific month.",
        name: "year",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(2, SlashChoice(...MONTH_CHOICES)),
    __param(2, SlashOption({
        description: "Month name or number (e.g., March or 3). Requires year.",
        name: "month",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Search by title substring",
        name: "title",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "If true, show results in the channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], NrGotmSearch.prototype, "search", null);
__decorate([
    Slash({
        description: "Nominate a game for the upcoming NR-GOTM round",
        name: "nominate",
    }),
    __param(0, SlashOption({
        description: "Game title to nominate",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "Reason for your nomination (max 250 chars)",
        name: "reason",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], NrGotmSearch.prototype, "nominate", null);
__decorate([
    Slash({
        description: "Delete your NR-GOTM nomination for the upcoming round",
        name: "delete-nomination",
    })
], NrGotmSearch.prototype, "deleteNomination", null);
__decorate([
    Slash({
        description: "List current NR-GOTM nominations for the upcoming round",
        name: "noms",
    })
], NrGotmSearch.prototype, "listNominations", null);
NrGotmSearch = __decorate([
    Discord(),
    SlashGroup({ description: "Non-RPG Game of the Month commands", name: "nr-gotm" }),
    SlashGroup("nr-gotm")
], NrGotmSearch);
export { NrGotmSearch };
function buildNominationEmbed(kindLabel, commandLabel, window, nominations) {
    const lines = nominations.length > 0
        ? nominations.map((n, idx) => {
            const reason = n.reason ? `\n> Reason: ${n.reason}` : "";
            return `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>${reason}`;
        })
        : ["No nominations yet."];
    const voteLabel = formatDate(window.nextVoteAt);
    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`${kindLabel} Nominations - Round ${window.targetRound}`)
        .setDescription(lines.join("\n"))
        .setFooter({
        text: `Vote on ${voteLabel}\n` +
            `Do you want to nominate a game? Use ${commandLabel}`,
    });
}
async function announceNomination(kindLabel, interaction, content, embed) {
    const channelId = NR_GOTM_NOMINATION_CHANNEL_ID;
    try {
        const channel = await interaction.client.channels.fetch(channelId);
        const textChannel = channel?.isTextBased()
            ? channel
            : null;
        if (!textChannel || !isSendableTextChannel(textChannel))
            return;
        await textChannel.send({ content, embeds: [embed] });
    }
    catch (err) {
        console.error(`Failed to announce ${kindLabel} nomination in channel ${channelId}:`, err);
    }
}
async function resolveNrGameDbGame(interaction, title) {
    const searchTerm = title.trim();
    const existing = await Game.searchGames(searchTerm);
    const exact = existing.find((g) => g.title.toLowerCase() === searchTerm.toLowerCase());
    if (exact)
        return exact;
    if (existing.length === 1)
        return existing[0] ?? null;
    let igdbResults = [];
    try {
        igdbResults = (await igdbService.searchGames(searchTerm)).results;
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await safeReply(interaction, {
            content: `IGDB search failed: ${msg}. Tag @merph518 if you need help importing.`,
            ephemeral: true,
        });
        return null;
    }
    if (!igdbResults.length) {
        await safeReply(interaction, {
            content: `No GameDB entry found and IGDB search returned no results for "${searchTerm}". ` +
                "Use /gamedb add to import first (tag @merph518 if you need help).",
            ephemeral: true,
        });
        return null;
    }
    if (igdbResults.length === 1) {
        return await importNrGameFromIgdb(interaction, igdbResults[0].id);
    }
    const opts = igdbResults.map((game) => {
        const year = game.first_release_date
            ? new Date(game.first_release_date * 1000).getFullYear()
            : "TBD";
        return {
            id: game.id,
            label: `${game.name} (${year})`,
            description: (game.summary || "No summary").substring(0, 95),
        };
    });
    return await new Promise((resolve) => {
        const { components, sessionId } = createIgdbSession(interaction.user.id, opts, async (sel, igdbId) => {
            const imported = await importNrGameFromIgdb(interaction, igdbId);
            deleteIgdbSession(sessionId);
            finish(imported);
            if (imported) {
                try {
                    await sel.update({ content: `Imported **${imported.title}**.`, components: [] });
                }
                catch {
                    // ignore
                }
            }
        });
        const timeout = setTimeout(async () => {
            deleteIgdbSession(sessionId);
            finish(null);
            await safeReply(interaction, {
                content: "Import cancelled or timed out. Nominations must be in GameDB first. " +
                    "Use /gamedb add to import (tag @merph518 if you have trouble).",
                flags: MessageFlags.Ephemeral,
            }).catch(() => { });
        }, 120000);
        const finish = (value) => {
            clearTimeout(timeout);
            resolve(value);
        };
        void safeReply(interaction, {
            content: "Game not found in GameDB. Select the IGDB match to import (paged).",
            components,
            ephemeral: true,
            __forceFollowUp: true,
        });
    });
}
async function importNrGameFromIgdb(interaction, igdbId) {
    const existing = await Game.getGameByIgdbId(igdbId);
    if (existing)
        return existing;
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
        await safeReply(interaction, {
            content: `Could not fetch IGDB details for id ${igdbId}.`,
            ephemeral: true,
        });
        return null;
    }
    let imageData = null;
    if (details.cover?.image_id) {
        try {
            const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
            const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
            imageData = Buffer.from(resp.data);
        }
        catch {
            // ignore
        }
    }
    const igdbUrl = details.url || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
    const newGame = await Game.createGame(details.name, details.summary || null, imageData, details.id, details.slug, details.total_rating ?? null, igdbUrl);
    await Game.saveFullGameMetadata(newGame.id, details);
    await processNrReleaseDates(newGame.id, details.release_dates || [], details.platforms || []);
    return newGame;
}
async function processNrReleaseDates(gameId, releaseDates, platforms) {
    if (!releaseDates || !Array.isArray(releaseDates)) {
        return;
    }
    for (const release of releaseDates) {
        const platformId = typeof release.platform === "number" ? release.platform : release.platform?.id ?? null;
        const platformName = typeof release.platform === "object"
            ? release.platform?.name ?? null
            : platforms.find((p) => p.id === platformId)?.name ?? null;
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
        catch {
            // ignore
        }
    }
}
function isSendableTextChannel(channel) {
    return Boolean(channel && typeof channel.send === "function");
}
function numberEmoji(n) {
    const lookup = {
        1: ":one:",
        2: ":two:",
        3: ":three:",
        4: ":four:",
        5: ":five:",
        6: ":six:",
        7: ":seven:",
        8: ":eight:",
        9: ":nine:",
        10: ":keycap_ten:",
    };
    return lookup[n] ?? `${n}.`;
}
function formatDate(date) {
    return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}
function parseMonthValue(input) {
    const trimmed = input.trim();
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= 12)
        return num;
    return trimmed;
}
async function buildNrGotmEmbeds(results, criteriaLabel, guildId, client) {
    const buildNoEmbed = (entry) => {
        return new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
            .setDescription("No Non-RPG nominations for this round.");
    };
    if (results.length > 12) {
        return buildCompactEmbeds(results, criteriaLabel, guildId).map((embed) => ({
            embed,
            files: [],
        }));
    }
    const assets = [];
    for (const entry of results) {
        if (isNoNrGotm(entry)) {
            assets.push({ embed: buildNoEmbed(entry), files: [] });
            continue;
        }
        const embedAssets = await buildNrGotmEntryEmbed(entry, guildId, client);
        assets.push(embedAssets);
    }
    return assets;
}
function buildCompactEmbeds(results, criteriaLabel, guildId) {
    const embeds = [];
    const MAX_FIELDS = 25;
    const baseEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("NR-GOTM Search Results");
    let current = baseEmbed;
    let fieldCount = 0;
    for (const entry of results) {
        const name = `NR-GOTM Round ${entry.round} - ${entry.monthYear}`;
        const value = formatGamesWithJump(entry, guildId);
        if (fieldCount >= MAX_FIELDS) {
            embeds.push(current);
            current = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle("NR-GOTM Search Results (cont.)");
            fieldCount = 0;
        }
        current.addFields({ name, value, inline: false });
        fieldCount++;
    }
    embeds.push(current);
    return embeds;
}
function chunkAssets(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
    }
    return out;
}
function displayValueSafe(value) {
    if (value === AUDIT_NO_VALUE_SENTINEL)
        return null;
    return value ?? null;
}
function formatGames(entry, _guildId) {
    void _guildId;
    const games = entry.gameOfTheMonth;
    if (!games || games.length === 0)
        return { body: "(no games listed)", winners: [] };
    const lines = [];
    const winners = [];
    for (const g of games) {
        const parts = [];
        const threadId = displayValueSafe(g.threadId);
        const redditUrl = displayValueSafe(g.redditUrl);
        const titleWithThread = threadId ? `${g.title} - <#${threadId}>` : g.title;
        parts.push(titleWithThread);
        if (redditUrl) {
            parts.push(`[Reddit](${redditUrl})`);
        }
        const firstLine = `- ${parts.join(" | ")}`;
        lines.push(firstLine);
        if (threadId)
            winners.push(threadId);
    }
    return { body: lines.join("\n"), winners };
}
function truncateField(value) {
    const MAX = 1024;
    if (value.length <= MAX)
        return value;
    return value.slice(0, MAX - 3) + "...";
}
function buildResultsJumpLink(entry, guildId) {
    if (!guildId || !ANNOUNCEMENTS_CHANNEL_ID)
        return undefined;
    const rawMsgId = entry.votingResultsMessageId;
    const msgId = displayValueSafe(rawMsgId);
    if (!msgId)
        return undefined;
    return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${msgId}`;
}
function formatGamesWithJump(entry, guildId) {
    const { body } = formatGames(entry, guildId);
    const link = buildResultsJumpLink(entry, guildId);
    if (!link)
        return truncateField(body);
    const tail = `[Voting Results](${link})`;
    return appendWithTailTruncate(body, tail);
}
function appendWithTailTruncate(body, tail) {
    const MAX = 1024;
    const sep = body ? "\n\n" : "";
    const total = body.length + sep.length + tail.length;
    if (total <= MAX)
        return body + sep + tail;
    const availForBody = MAX - tail.length - sep.length;
    if (availForBody <= 0)
        return tail.slice(0, MAX);
    const trimmedBody = body.slice(0, Math.max(0, availForBody - 3)) + "...";
    return trimmedBody + sep + tail;
}
