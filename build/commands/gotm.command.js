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
        // Determine search mode
        let results = [];
        let criteriaLabel = "";
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
                await safeReply(interaction, { content: "Please provide at least one of: round, (year and optionally month), or title.", ephemeral: true });
                return;
            }
            if (!results || results.length === 0) {
                await safeReply(interaction, { content: `No GOTM entries found for ${criteriaLabel}.`, ephemeral: true });
                return;
            }
            const embeds = buildGotmEmbeds(results, criteriaLabel, interaction.guildId ?? undefined);
            await safeReply(interaction, { embeds });
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
function buildGotmEmbeds(results, criteriaLabel, guildId) {
    // Create a base embed with styling similar to ThreadCreated event
    const embeds = [];
    const MAX_FIELDS = 25;
    const baseEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("GOTM Search Results")
        .setDescription(`Query: "${criteriaLabel}"`);
    let current = baseEmbed;
    let fieldCount = 0;
    for (const entry of results) {
        const fieldName = `Round ${entry.round} - ${entry.monthYear}`;
        const fieldValue = formatGames(entry.gameOfTheMonth, guildId);
        const value = truncateField(fieldValue);
        if (fieldCount >= MAX_FIELDS) {
            embeds.push(current);
            current = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle("GOTM Search Results (cont.)")
                .setDescription(criteriaLabel);
            fieldCount = 0;
        }
        current.addFields({ name: fieldName, value, inline: false });
        fieldCount++;
    }
    embeds.push(current);
    return embeds;
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
// Ensure we do not hit "Interaction already acknowledged" when errors occur
async function safeReply(interaction, options) {
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(options);
    }
    else {
        await interaction.reply(options);
    }
}
