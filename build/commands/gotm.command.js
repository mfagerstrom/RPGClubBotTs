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
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
// Use relative import with .js for ts-node ESM compatibility
import Gotm from "../classes/Gotm.js";
const ANNOUNCEMENTS_CHANNEL_ID = process.env.ANNOUNCEMENTS_CHANNEL_ID;
// Precompute dropdown choices
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
        const entries = Gotm.all();
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
let GotmSearch = class GotmSearch {
    async gotm(round, year, month, title, interaction) {
        // Acknowledge early to avoid interaction timeouts while fetching images
        try {
            await interaction.deferReply?.();
        }
        catch { }
        // Determine search mode
        let results = [];
        let criteriaLabel;
        try {
            if (round !== undefined && round !== null) {
                results = Gotm.getByRound(Number(round));
                criteriaLabel = `Round ${round}`;
            }
            else if (title && title.trim().length > 0) {
                results = Gotm.searchByTitle(title);
                criteriaLabel = `Title contains "${title}"`;
            }
            else if (year !== undefined && year !== null) {
                if (month && month.trim().length > 0) {
                    const monthValue = parseMonthValue(month);
                    results = Gotm.getByYearMonth(Number(year), monthValue);
                    const monthLabel = typeof monthValue === 'number' ? monthValue.toString() : monthValue;
                    criteriaLabel = `Year ${year}, Month ${monthLabel}`;
                }
                else {
                    results = Gotm.getByYear(Number(year));
                    criteriaLabel = `Year ${year}`;
                }
            }
            else {
                // Default: show current round (highest round number in data)
                const all = Gotm.all();
                if (!all.length) {
                    await safeReply(interaction, { content: "No GOTM data available.", ephemeral: true });
                    return;
                }
                const currentRound = Math.max(...all.map((e) => e.round));
                results = Gotm.getByRound(currentRound);
                // no criteriaLabel so the embed omits the query line
            }
            if (!results || results.length === 0) {
                await safeReply(interaction, { content: `No GOTM entries found for ${criteriaLabel}.`, ephemeral: true });
                return;
            }
            const embeds = await buildGotmEmbeds(results, criteriaLabel, interaction.guildId ?? undefined, interaction.client);
            const content = criteriaLabel ? `Query: "${criteriaLabel}"` : undefined;
            if (embeds.length <= 10) {
                await safeReply(interaction, { content, embeds });
            }
            else {
                const chunks = chunkEmbeds(embeds, 10);
                await safeReply(interaction, { content, embeds: chunks[0] });
                for (let i = 1; i < chunks.length; i++) {
                    await interaction.followUp({ embeds: chunks[i] });
                }
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, { content: `Error processing request: ${msg}`, ephemeral: true });
        }
    }
};
__decorate([
    Slash({ description: "Search Game of the Month (GOTM)", name: "gotm" }),
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
    }))
], GotmSearch.prototype, "gotm", null);
GotmSearch = __decorate([
    Discord()
], GotmSearch);
export { GotmSearch };
function parseMonthValue(input) {
    const trimmed = input.trim();
    const num = Number(trimmed);
    if (Number.isInteger(num) && num >= 1 && num <= 12)
        return num;
    return trimmed;
}
async function buildGotmEmbeds(results, criteriaLabel, guildId, client) {
    // If many results, fall back to compact, field-based embeds (no thumbnails)
    if (results.length > 12) {
        return buildCompactEmbeds(results, criteriaLabel, guildId);
    }
    const embeds = [];
    for (const entry of results) {
        const desc = formatGamesWithJump(entry, guildId);
        const embed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`Round ${entry.round} - ${entry.monthYear}`)
            .setDescription(desc);
        // Also set the embed URL so the title becomes a clickable jump link
        const jumpLink = buildResultsJumpLink(entry, guildId);
        if (jumpLink)
            embed.setURL(jumpLink);
        // Find first available thread image among this entry's games
        for (const g of entry.gameOfTheMonth) {
            if (!g.threadId)
                continue;
            const imgUrl = await resolveThreadImageUrl(client, g.threadId).catch(() => undefined);
            if (imgUrl) {
                embed.setThumbnail(imgUrl);
                break;
            }
        }
        embeds.push(embed);
    }
    return embeds;
}
function buildCompactEmbeds(results, criteriaLabel, guildId) {
    const embeds = [];
    const MAX_FIELDS = 25;
    const baseEmbed = new EmbedBuilder().setColor(0x0099ff).setTitle("GOTM Search Results");
    let current = baseEmbed;
    let fieldCount = 0;
    for (const entry of results) {
        const name = `Round ${entry.round} - ${entry.monthYear}`;
        const value = formatGamesWithJump(entry, guildId);
        if (fieldCount >= MAX_FIELDS) {
            embeds.push(current);
            current = new EmbedBuilder().setColor(0x0099ff).setTitle("GOTM Search Results (cont.)");
            fieldCount = 0;
        }
        current.addFields({ name, value, inline: false });
        fieldCount++;
    }
    embeds.push(current);
    return embeds;
}
// Heavily inspired by ThreadCreated.command.ts logic, simplified for lookups
async function resolveThreadImageUrl(client, threadId) {
    try {
        const channel = await client.channels.fetch(threadId);
        const anyThread = channel;
        if (!anyThread || typeof anyThread.fetchStarterMessage !== 'function')
            return undefined;
        const starter = await anyThread.fetchStarterMessage().catch(() => null);
        if (!starter)
            return undefined;
        // attachments first
        for (const att of starter.attachments?.values?.() ?? []) {
            const anyAtt = att;
            const nameLc = (anyAtt.name ?? '').toLowerCase();
            const ctype = (anyAtt.contentType ?? '').toLowerCase();
            if (ctype.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) || anyAtt.width) {
                return anyAtt.url ?? anyAtt.proxyURL;
            }
        }
        // embeds images and thumbnails (consider proxy urls)
        for (const emb of starter.embeds ?? []) {
            const anyEmb = emb;
            const imgUrl = emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
            const thumbUrl = emb.thumbnail?.url || anyEmb?.thumbnail?.proxyURL || anyEmb?.thumbnail?.proxy_url;
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
function formatGames(games, guildId) {
    if (!games || games.length === 0)
        return "(no games listed)";
    const lines = [];
    for (const g of games) {
        const parts = [];
        const titleWithThread = g.threadId ? `${g.title} - <#${g.threadId}>` : g.title;
        parts.push(titleWithThread);
        if (g.redditUrl) {
            parts.push(`[Reddit](${g.redditUrl})`);
        }
        const firstLine = `- ${parts.join(' | ')}`;
        lines.push(firstLine);
    }
    return lines.join('\n');
}
function truncateField(value) {
    const MAX = 1024; // Discord embed field value limit
    if (value.length <= MAX)
        return value;
    return value.slice(0, MAX - 3) + '...';
}
function buildResultsJumpLink(entry, guildId) {
    if (!guildId || !ANNOUNCEMENTS_CHANNEL_ID)
        return undefined;
    const msgId = entry.votingResultsMessageId;
    if (!msgId)
        return undefined;
    return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${msgId}`;
}
function formatGamesWithJump(entry, guildId) {
    const body = formatGames(entry.gameOfTheMonth, guildId);
    const link = buildResultsJumpLink(entry, guildId);
    if (!link)
        return truncateField(body);
    const tail = `[Voting Results](${link})`;
    return appendWithTailTruncate(body, tail);
}
function appendWithTailTruncate(body, tail) {
    const MAX = 1024; // Align with existing truncateField limit
    const sep = body ? '\n\n' : '';
    const total = body.length + sep.length + tail.length;
    if (total <= MAX)
        return body + sep + tail;
    const availForBody = MAX - tail.length - sep.length;
    if (availForBody <= 0)
        return tail.slice(0, MAX);
    const trimmedBody = body.slice(0, Math.max(0, availForBody - 3)) + '...';
    return trimmedBody + sep + tail;
}
// Ensure we do not hit "Interaction already acknowledged" when errors occur
async function safeReply(interaction, options) {
    const deferred = interaction.deferred;
    const replied = interaction.replied;
    if (deferred && !replied) {
        const { ephemeral, ...rest } = options ?? {};
        await interaction.editReply(rest);
        return;
    }
    if (replied || deferred) {
        const { ephemeral, ...rest } = options ?? {};
        await interaction.followUp(rest);
        return;
    }
    await interaction.reply(options);
}
