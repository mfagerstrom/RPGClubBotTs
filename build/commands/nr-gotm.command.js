var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { AUDIT_NO_VALUE_SENTINEL } from "./superadmin.command.js";
// Use relative import with .js for ts-node ESM compatibility
import NrGotm from "../classes/NrGotm.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { areNominationsClosed, getUpcomingNominationWindow, } from "../functions/NominationWindow.js";
import { deleteNominationForUser, getNominationForUser, listNominationsForRound, upsertNomination, } from "../classes/Nomination.js";
import { NR_GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { buildNrGotmHelpResponse } from "./help.command.js";
const ANNOUNCEMENTS_CHANNEL_ID = process.env.ANNOUNCEMENTS_CHANNEL_ID;
function displayAuditValue(value) {
    if (value === AUDIT_NO_VALUE_SENTINEL)
        return null;
    return value ?? null;
}
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
        await safeDeferReply(interaction, { ephemeral });
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
                        ephemeral: true,
                    });
                    return;
                }
                const currentRound = Math.max(...all.map((e) => e.round));
                results = NrGotm.getByRound(currentRound);
            }
            if (!results || results.length === 0) {
                await safeReply(interaction, {
                    content: `No NR-GOTM entries found for ${criteriaLabel}.`,
                    ephemeral: true,
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
            const embeds = await buildNrGotmEmbeds(embedsResults, criteriaLabel, interaction.guildId ?? undefined, interaction.client);
            const content = criteriaLabel ? `Query: "${criteriaLabel}"` : undefined;
            if (embeds.length <= 10) {
                await safeReply(interaction, { content, embeds, ephemeral });
            }
            else {
                const chunks = chunkEmbeds(embeds, 10);
                await safeReply(interaction, { content, embeds: chunks[0], ephemeral });
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ embeds: chunks[i], ephemeral });
                }
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error processing request: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async nominate(title, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const cleaned = title?.trim();
        if (!cleaned) {
            await safeReply(interaction, {
                content: "Please provide a non-empty game title to nominate.",
            });
            return;
        }
        try {
            const window = await getUpcomingNominationWindow();
            if (areNominationsClosed(window)) {
                await safeReply(interaction, {
                    content: `Nominations for Round ${window.targetRound} are closed. ` +
                        `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
                    ephemeral: true,
                });
                return;
            }
            const userId = interaction.user.id;
            const existing = await getNominationForUser("nr-gotm", window.targetRound, userId);
            const saved = await upsertNomination("nr-gotm", window.targetRound, userId, cleaned);
            const replaced = existing && existing.gameTitle !== saved.gameTitle
                ? ` (replaced "${existing.gameTitle}")`
                : existing
                    ? " (no change to title)"
                    : "";
            await safeReply(interaction, {
                content: `${existing ? "Updated" : "Recorded"} your NR-GOTM nomination for Round ${window.targetRound}: "${saved.gameTitle}".${replaced}`,
                ephemeral: true,
            });
            const nominations = await listNominationsForRound("nr-gotm", window.targetRound);
            const embed = buildNominationEmbed("NR-GOTM", "/nr-gotm nominate", window, nominations);
            const content = `<@${interaction.user.id}> nominated "${saved.gameTitle}" for NR-GOTM Round ${window.targetRound}.`;
            await announceNomination("NR-GOTM", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not save your nomination: ${msg}`,
                ephemeral: true,
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
                    ephemeral: true,
                });
                return;
            }
            const userId = interaction.user.id;
            const existing = await getNominationForUser("nr-gotm", window.targetRound, userId);
            if (!existing) {
                await safeReply(interaction, {
                    content: `You do not have an NR-GOTM nomination for Round ${window.targetRound}.`,
                    ephemeral: true,
                });
                return;
            }
            await deleteNominationForUser("nr-gotm", window.targetRound, userId);
            const nominations = await listNominationsForRound("nr-gotm", window.targetRound);
            await safeReply(interaction, {
                content: `Deleted your NR-GOTM nomination for Round ${window.targetRound}: "${existing.gameTitle}".`,
                ephemeral: true,
            });
            const embed = buildNominationEmbed("NR-GOTM", "/nr-gotm nominate", window, nominations);
            const content = `<@${interaction.user.id}> removed their NR-GOTM nomination "${existing.gameTitle}" for NR-GOTM Round ${window.targetRound}.`;
            await announceNomination("NR-GOTM", interaction, content, embed);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Could not delete your nomination: ${msg}`,
                ephemeral: true,
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
        ? nominations.map((n, idx) => `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>`)
        : ["No nominations yet."];
    const closesLabel = formatCloseLabel(window.closesAt);
    const voteLabel = formatDate(window.nextVoteAt);
    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`${kindLabel} Nominations - Round ${window.targetRound}`)
        .setDescription(lines.join("\n"))
        .setFooter({
        text: `Closes ${closesLabel} • Vote on ${voteLabel}\n` +
            `Do you want to nominate a game? Use ${commandLabel}`,
    });
}
async function announceNomination(kindLabel, interaction, content, embed) {
    const channelId = NR_GOTM_NOMINATION_CHANNEL_ID;
    try {
        const channel = await interaction.client.channels.fetch(channelId);
        const textChannel = channel?.isTextBased() ? channel : null;
        if (!textChannel || !isSendableTextChannel(textChannel))
            return;
        await textChannel.send({ content, embeds: [embed] });
    }
    catch (err) {
        console.error(`Failed to announce ${kindLabel} nomination in channel ${channelId}:`, err);
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
function formatCloseLabel(date) {
    const datePart = formatDate(date);
    return `${datePart} 11:00 PM ET`;
}
function parseMonthValue(input) {
    const trimmed = input.trim();
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= 12)
        return num;
    return trimmed;
}
async function buildNrGotmEmbeds(results, criteriaLabel, guildId, client) {
    const embeds = [];
    const buildNoEmbed = (entry) => {
        return new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
            .setDescription("No Non-RPG nominations for this round.");
    };
    for (const entry of results) {
        if (isNoNrGotm(entry)) {
            embeds.push(buildNoEmbed(entry));
            continue;
        }
        const { body } = formatGames(entry, guildId);
        const desc = formatGamesWithJump(entry, guildId);
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
            .setDescription(desc || body);
        const jumpLink = buildResultsJumpLink(entry, guildId);
        if (jumpLink)
            embed.setURL(jumpLink);
        for (const g of entry.gameOfTheMonth) {
            const threadId = displayAuditValue(g.threadId);
            if (!threadId)
                continue;
            const imgUrl = await resolveThreadImageUrl(client, threadId).catch(() => undefined);
            if (imgUrl) {
                embed.setThumbnail(imgUrl);
                break;
            }
        }
        embeds.push(embed);
    }
    if (embeds.length === 0 && results.length > 12) {
        return buildCompactEmbeds(results, criteriaLabel, guildId);
    }
    return embeds;
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
async function resolveThreadImageUrl(client, threadId) {
    try {
        const channel = await client.channels.fetch(threadId);
        const anyThread = channel;
        if (!anyThread || typeof anyThread.fetchStarterMessage !== "function")
            return undefined;
        const starter = await anyThread.fetchStarterMessage().catch(() => null);
        if (!starter)
            return undefined;
        for (const att of starter.attachments?.values?.() ?? []) {
            const anyAtt = att;
            const nameLc = (anyAtt.name ?? "").toLowerCase();
            const ctype = (anyAtt.contentType ?? "").toLowerCase();
            if (ctype.startsWith("image/") ||
                /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) ||
                anyAtt.width) {
                return anyAtt.url ?? anyAtt.proxyURL;
            }
        }
        for (const emb of starter.embeds ?? []) {
            const anyEmb = emb;
            const imgUrl = emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
            const thumbUrl = emb.thumbnail?.url ||
                anyEmb?.thumbnail?.proxyURL ||
                anyEmb?.thumbnail?.proxy_url;
            if (imgUrl)
                return imgUrl;
            if (thumbUrl)
                return thumbUrl;
        }
    }
    catch {
        // ignore
    }
    return undefined;
}
function chunkEmbeds(list, size) {
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
function formatGames(entry, guildId) {
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
