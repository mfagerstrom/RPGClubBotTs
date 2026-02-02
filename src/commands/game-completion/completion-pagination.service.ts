import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { renderCompletionPage, renderSelectionPage } from "./completion-list.service.js";

/**
 * Parses a year filter string into a number, "unknown", or null
 */
export function parseCompletionYearFilter(yearRaw: string): number | "unknown" | null {
  if (!yearRaw) return null;
  if (yearRaw.toLowerCase() === "unknown") return "unknown";
  const parsed = Number(yearRaw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Handles page selection from dropdown menu for list, edit, or delete modes
 */
export async function handleCompletionPageSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const ownerId = parts[1];
  const yearRaw = parts[2];
  const mode = parts[3] as "list" | "edit" | "delete";
  const query = parts.slice(4).join(":") || undefined;

  if (mode !== "list" && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This list isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const page = Number(interaction.values[0]);
  if (Number.isNaN(page)) return;
  const year = parseCompletionYearFilter(yearRaw);
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  try {
    await interaction.deferUpdate();
  } catch {
    // ignore
  }

  if (mode === "list") {
    await renderCompletionPage(
      interaction,
      ownerId,
      page,
      year,
      ephemeral,
      query,
    );
  } else {
    await renderSelectionPage(interaction, ownerId, page, mode, year, query);
  }
}

/**
 * Handles prev/next button clicks for list, edit, or delete pagination
 */
export async function handleCompletionPaging(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  const mode = parts[0].split("-")[1] as "list" | "edit" | "delete";
  const ownerId = parts[1];
  const yearRaw = parts[2];
  const pageRaw = parts[3];
  const dir = parts[4];
  const query = parts.slice(5).join(":") || undefined;

  if (mode !== "list" && interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This list isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const page = Number(pageRaw);
  if (Number.isNaN(page)) return;
  const nextPage = dir === "next" ? page + 1 : Math.max(page - 1, 0);
  const year = parseCompletionYearFilter(yearRaw);
  const ephemeral = interaction.message?.flags?.has(MessageFlags.Ephemeral) ?? true;

  try {
    await interaction.deferUpdate();
  } catch {
    // ignore
  }

  if (mode === "list") {
    await renderCompletionPage(
      interaction,
      ownerId,
      nextPage,
      year,
      ephemeral,
      query,
    );
  } else {
    await renderSelectionPage(interaction, ownerId, nextPage, mode, year, query);
  }
}

/**
 * Handles leaderboard member selection to view their completions
 */
export async function handleCompletionLeaderboardSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const parts = interaction.customId.split(":");
  const query = parts.slice(1).join(":") || undefined;
  const userId = interaction.values[0];
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await renderCompletionPage(interaction, userId, 0, null, true, query);
}
