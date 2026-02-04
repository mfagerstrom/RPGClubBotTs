// Autocomplete utilities for game completion commands

import type { AutocompleteInteraction } from "discord.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import { formatGameTitleWithYear } from "../../functions/GameTitleAutocompleteUtils.js";
import Game, { type IPlatformDef } from "../../classes/Game.js";
import Member from "../../classes/Member.js";
import { formatTableDate } from "../profile.command.js";

const PLATFORM_CACHE_TTL_MS = 5 * 60 * 1000;
const COMPLETION_TITLE_VALUE_PREFIX = "completion";

let platformCache: { expiresAt: number; platforms: IPlatformDef[] } | null = null;

async function getCachedPlatforms(): Promise<IPlatformDef[]> {
  const now = Date.now();
  if (platformCache && platformCache.expiresAt > now) {
    return platformCache.platforms;
  }

  const platforms = await Game.getAllPlatforms();
  platformCache = {
    expiresAt: now + PLATFORM_CACHE_TTL_MS,
    platforms,
  };
  return platforms;
}

function normalizePlatformSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function buildPlatformAutocompleteLabel(platform: IPlatformDef): string {
  const detail = platform.abbreviation ? `${platform.name} (${platform.abbreviation})` : platform.name;
  return detail.slice(0, 100);
}

export function buildKeepTypingOption(query: string): { name: string; value: string } {
  const label = `Keep typing: "${query}"`;
  return {
    name: label.slice(0, 100),
    value: query,
  };
}

export async function autocompleteGameCompletionTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGamesAutocomplete(query);
  const resultOptions = results.slice(0, 24).map((game) => ({
    name: formatGameTitleWithYear(game).slice(0, 100),
    value: game.title,
  }));
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}

function buildCompletionTitleAutocompleteName(completion: {
  title: string;
  completionType: string;
  completedAt: Date | null;
}): string {
  const dateLabel = completion.completedAt ? formatTableDate(completion.completedAt) : "No date";
  const line = `${completion.title} | ${completion.completionType} | ${dateLabel}`;
  return line.slice(0, 100);
}

function buildCompletionTitleAutocompleteValue(completionId: number): string {
  return `${COMPLETION_TITLE_VALUE_PREFIX}:${completionId}`;
}

export function parseCompletionTitleAutocompleteValue(raw: string): number | null {
  const normalized = raw.trim();
  const match = /^completion:(\d+)$/.exec(normalized);
  if (!match) return null;
  const completionId = Number(match[1]);
  if (!Number.isInteger(completionId) || completionId <= 0) return null;
  return completionId;
}

export async function autocompleteUserCompletionTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();

  const completions = await Member.getCompletions({
    userId: interaction.user.id,
    limit: 25,
    title: query || undefined,
  });

  const options = completions.map((completion) => ({
    name: buildCompletionTitleAutocompleteName(completion),
    value: buildCompletionTitleAutocompleteValue(completion.completionId),
  }));

  await interaction.respond(options.slice(0, 25));
}

export async function autocompleteGameCompletionPlatform(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = normalizePlatformSearchText(
    sanitizeUserInput(rawQuery, { preserveNewlines: false }),
  );

  const platforms = await getCachedPlatforms();
  const filtered = query
    ? platforms.filter((platform) => {
      const name = normalizePlatformSearchText(platform.name);
      const abbreviation = normalizePlatformSearchText(platform.abbreviation ?? "");
      const code = normalizePlatformSearchText(platform.code);
      return name.includes(query) || abbreviation.includes(query) || code.includes(query);
    })
    : platforms;

  const options = filtered
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .slice(0, 25)
    .map((platform) => ({
      name: buildPlatformAutocompleteLabel(platform),
      value: String(platform.id),
    }));

  await interaction.respond(options);
}

export async function resolveGameCompletionPlatformId(
  rawInput: string | null | undefined,
): Promise<number | null> {
  if (!rawInput) {
    return null;
  }

  const value = normalizePlatformSearchText(rawInput);
  if (!value) {
    return null;
  }

  const platforms = await getCachedPlatforms();

  const asId = Number(value);
  if (Number.isInteger(asId) && asId > 0) {
    return platforms.some((platform) => platform.id === asId) ? asId : null;
  }

  const exact = platforms.find((platform) => {
    const name = normalizePlatformSearchText(platform.name);
    const abbreviation = normalizePlatformSearchText(platform.abbreviation ?? "");
    const code = normalizePlatformSearchText(platform.code);
    return value === name || value === abbreviation || value === code;
  });
  if (exact) {
    return exact.id;
  }

  const partialMatches = platforms.filter((platform) => {
    const name = normalizePlatformSearchText(platform.name);
    const abbreviation = normalizePlatformSearchText(platform.abbreviation ?? "");
    const code = normalizePlatformSearchText(platform.code);
    return name.includes(value) || abbreviation.includes(value) || code.includes(value);
  });

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  }

  return null;
}

export async function resolveGameCompletionPlatformLabel(
  platformId: number | null | undefined,
): Promise<string> {
  if (platformId == null) {
    return "No platform";
  }

  const platforms = await getCachedPlatforms();
  const platform = platforms.find((entry) => entry.id === platformId);
  if (!platform) {
    return `Platform #${platformId}`;
  }

  return buildPlatformAutocompleteLabel(platform);
}
