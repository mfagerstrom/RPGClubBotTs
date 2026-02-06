// Helper utilities for game completion functionality

import type {
  CommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import Member from "../../classes/Member.js";
import { promptRemoveFromNowPlaying } from "../../functions/CompletionHelpers.js";

function shouldPromptNowPlayingRemoval(
  addedAt: Date | null,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): boolean {
  if (!addedAt) return true;
  if (!requireCompletionAfterAdded) return true;
  if (!completedAt) return true;
  return completedAt >= addedAt;
}

export async function resolveNowPlayingRemoval(
  interaction:
    | CommandInteraction
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction,
  userId: string,
  gameId: number,
  gameTitle: string,
  completedAt: Date | null,
  requireCompletionAfterAdded: boolean,
): Promise<boolean> {
  const nowPlayingMeta = await Member.getNowPlayingEntryMeta(userId, gameId);
  if (!nowPlayingMeta) {
    return false;
  }
  const shouldPrompt = shouldPromptNowPlayingRemoval(
    nowPlayingMeta.addedAt,
    completedAt,
    requireCompletionAfterAdded,
  );
  if (!shouldPrompt) {
    return false;
  }
  return promptRemoveFromNowPlaying(interaction, gameTitle);
}

export function escapeCsv(field: string): string {
  if (field.includes(",") || field.includes('"') || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function getCompletionatorThreadKey(userId: string, importId: number): string {
  return `${userId}:${importId}`;
}

export function getCompletionatorFormKey(importId: number, itemId: number): string {
  return `${importId}:${itemId}`;
}

export function buildCompletionatorChooseId(params: {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
}): string {
  return `comp-import-choose-v1:${params.ownerId}:${params.importId}:${params.itemId}:${params.gameId}`;
}

export function parseCompletionatorChooseId(customId: string): {
  ownerId: string;
  importId: number;
  itemId: number;
  gameId: number;
} | null {
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  const [prefix, ownerId, importIdRaw, itemIdRaw, gameIdRaw] = parts;
  if (prefix !== "comp-import-choose-v1") return null;
  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  const gameId = Number(gameIdRaw);
  if (
    !ownerId ||
    !Number.isInteger(importId) ||
    !Number.isInteger(itemId) ||
    !Number.isInteger(gameId)
  ) {
    return null;
  }
  return {
    ownerId,
    importId,
    itemId,
    gameId,
  };
}
