import type { AutocompleteInteraction, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { EmbedBuilder } from "discord.js";
import { searchHltb, type HltbSearchResult } from "../scripts/SearchHltb.js";
import Game from "../classes/Game.js";
import { getHltbCacheByGameId, upsertHltbCache } from "../classes/HltbCache.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";

type TitleParseResult = {
  title: string;
  year: number | null;
  hasYearSuffix: boolean;
};

function parseTitleWithYear(input: string): TitleParseResult {
  const match = input.match(/^(.*)\s\((\d{4}|Unknown Year)\)$/);
  if (match) {
    const baseTitle = match[1].trim();
    const yearToken = match[2];
    if (yearToken === "Unknown Year") {
      return { title: baseTitle, year: null, hasYearSuffix: true };
    }
    const parsedYear = Number(yearToken);
    if (!Number.isNaN(parsedYear)) {
      return { title: baseTitle, year: parsedYear, hasYearSuffix: true };
    }
  }
  return { title: input, year: null, hasYearSuffix: false };
}

function getReleaseYear(game: { initialReleaseDate?: Date | null }): number | null {
  const releaseDate = game.initialReleaseDate;
  if (!releaseDate) return null;
  const date = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

function formatGameTitleWithYear(
  game: { title: string; initialReleaseDate?: Date | null },
  isDuplicate: boolean,
): string {
  if (!isDuplicate) {
    return game.title;
  }
  const year = getReleaseYear(game);
  const yearText = year ? ` (${year})` : " (Unknown Year)";
  return `${game.title}${yearText}`;
}

function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, 100),
    value: query,
  };
}

async function autocompleteHltbTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGames(query);
  const titleCounts = new Map<string, number>();
  results.forEach((game) => {
    const title = String(game.title ?? "");
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  });
  const resultOptions = results.slice(0, 24).map((game) => {
    const title = String(game.title ?? "");
    const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
    const label = formatGameTitleWithYear(game, isDuplicate);
    return {
      name: label.slice(0, 100),
      value: label,
    };
  });
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™ Search" })
  async hltb(
    @SlashOption({
      description: "Game title (autocomplete from GameDB)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteHltbTitle,
    })
    title: string,
    @SlashOption({
      description: "If set to true, show the results in the channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    title = sanitizeUserInput(title, { preserveNewlines: false });
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    try {
      const result = await resolveHltbResult(title);
      await outputHltbResultsAsEmbed(interaction, result, title, { ephemeral });
  } catch {
      await safeReply(interaction, {
        content: `Sorry, there was an error searching for "${title}". Please try again later.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  }
}

async function outputHltbResultsAsEmbed(
  interaction: CommandInteraction,
  result: HltbSearchResult | null,
  hltbQuery: string,
  options: { ephemeral: boolean },
) {

  if (result) {
    const hltb_result = result;

    const fields = [];

    if (hltb_result.singlePlayer) {
      fields.push({
        name: 'Single-Player',
        value: hltb_result.singlePlayer,
        inline: true,
      });
    }

    if (hltb_result.coOp) {
      fields.push({
        name: 'Co-Op',
        value: hltb_result.coOp,
        inline: true,
      });
    }

    if (hltb_result.vs) {
      fields.push({
        name: 'Vs.',
        value: hltb_result.vs,
        inline: true,
      });
    }

    if (hltb_result.main) {
      fields.push({
        name: 'Main',
        value: hltb_result.main,
        inline: true,
      });
    }

    if (hltb_result.mainSides) {
      fields.push({
        name: 'Main + Sides',
        value: hltb_result.mainSides,
        inline: true,
      });
    }

    if (hltb_result.completionist) {
      fields.push({
        name: 'Completionist',
        value: hltb_result.completionist,
        inline: true,
      });
    }

    const hltbEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`How Long to Beat ${hltb_result.name}`)
      .setAuthor({
        name: 'HowLongToBeat™',
        iconURL: 'https://howlongtobeat.com/img/hltb_brand.png',
        url: 'https://howlongtobeat.com',
      })
      .setFields(fields);

    if (hltb_result.url) {
      hltbEmbed.setURL(hltb_result.url);
    }
    if (hltb_result.imageUrl) {
      hltbEmbed.setImage(hltb_result.imageUrl);
    }

    await safeReply(interaction, {
      embeds: [hltbEmbed],
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  } else {
    await safeReply(interaction, {
      content: `Sorry, no results were found for "${hltbQuery}"`,
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}

async function resolveHltbResult(title: string): Promise<HltbSearchResult | null> {
  const parsedTitle = parseTitleWithYear(title.trim());
  const searchTerm = parsedTitle.title.trim();
  if (!searchTerm) return null;

  const matches = await Game.searchGames(searchTerm);
  const normalizedTitle = searchTerm.toLowerCase();
  const exactTitleMatches = matches.filter(
    (game) => game.title.toLowerCase() === normalizedTitle,
  );
  let candidate: (typeof matches)[number] | null = null;
  if (parsedTitle.hasYearSuffix && exactTitleMatches.length > 0) {
    if (parsedTitle.year !== null) {
      candidate = exactTitleMatches.find(
        (game) => getReleaseYear(game) === parsedTitle.year,
      ) ?? null;
    } else {
      candidate = exactTitleMatches.find(
        (game) => getReleaseYear(game) === null,
      ) ?? null;
    }
  }
  if (!candidate) {
    const exactMatch = exactTitleMatches[0] ?? null;
    candidate = exactMatch ?? (matches.length === 1 ? matches[0] : null);
  }

  if (candidate) {
    const cache = await getHltbCacheByGameId(candidate.id);
    if (cache) {
      return {
        name: cache.name ?? candidate.title,
        main: cache.main ?? "",
        mainSides: cache.mainSides ?? "",
        completionist: cache.completionist ?? "",
        singlePlayer: cache.singlePlayer ?? "",
        coOp: cache.coOp ?? "",
        vs: cache.vs ?? "",
        imageUrl: cache.imageUrl ?? undefined,
        url: cache.url ?? "",
      };
    }
  }

  const scraped = await searchHltb(searchTerm);
  if (!scraped) return null;

  if (candidate && candidate.initialReleaseDate) {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (candidate.initialReleaseDate <= sixMonthsAgo) {
      await upsertHltbCache(candidate.id, {
        name: scraped.name,
        url: scraped.url,
        imageUrl: scraped.imageUrl ?? null,
        main: scraped.main,
        mainSides: scraped.mainSides,
        completionist: scraped.completionist,
        singlePlayer: scraped.singlePlayer,
        coOp: scraped.coOp,
        vs: scraped.vs,
        sourceQuery: searchTerm,
      });
    }
  }

  return scraped;
}
