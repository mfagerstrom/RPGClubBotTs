// Autocomplete utilities for game completion commands

import type { AutocompleteInteraction } from "discord.js";
import { sanitizeUserInput } from "../../functions/InteractionUtils.js";
import Game from "../../classes/Game.js";

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
    name: game.title.slice(0, 100),
    value: game.title,
  }));
  const options = [buildKeepTypingOption(query), ...resultOptions];
  await interaction.respond(options);
}
