// Platform selection workflow for game completions

import type { CommandInteraction, StringSelectMenuInteraction, ButtonInteraction } from "discord.js";
import { ActionRowBuilder, StringSelectMenuBuilder, MessageFlags } from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { notifyUnknownCompletionPlatform, saveCompletion } from "../../functions/CompletionHelpers.js";
import Game from "../../classes/Game.js";
import { STANDARD_PLATFORM_IDS } from "../../config/standardPlatforms.js";
import {
  COMPLETION_PLATFORM_SELECT_PREFIX,
  completionPlatformSessions,
  type CompletionPlatformContext,
} from "./completion.types.js";

export function createCompletionPlatformSession(ctx: CompletionPlatformContext): string {
  const sessionId = `comp-platform-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  completionPlatformSessions.set(sessionId, ctx);
  return sessionId;
}

export async function promptCompletionPlatformSelection(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  ctx: Omit<CompletionPlatformContext, "platforms">,
): Promise<void> {
  const platforms = await Game.getPlatformsForGameWithStandard(
    ctx.gameId,
    STANDARD_PLATFORM_IDS,
  );
  if (!platforms.length) {
    await safeReply(interaction, {
      content: "No platform release data is available for this game.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const platformOptions = [...platforms]
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }))
    .map((platform) => ({
      id: platform.id,
      name: platform.name,
    }));
  const sessionId = createCompletionPlatformSession({
    ...ctx,
    platforms: platformOptions,
  });

  const baseOptions = platformOptions.map((platform) => ({
    label: platform.name.slice(0, 100),
    value: String(platform.id),
  }));
  const options = [
    ...baseOptions.slice(0, 24),
    { label: "Other", value: "other" },
  ];
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${COMPLETION_PLATFORM_SELECT_PREFIX}:${sessionId}`)
    .setPlaceholder("Select the platform")
    .addOptions(options);
  const content = platformOptions.length > 24
    ? `Select the platform for **${ctx.gameTitle}** (showing first 24).`
    : `Select the platform for **${ctx.gameTitle}**.`;

  await safeReply(interaction, {
    content,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleCompletionPlatformSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, sessionId] = interaction.customId.split(":");
  const ctx = completionPlatformSessions.get(sessionId);

  if (!ctx) {
    await interaction.reply({
      content: "This completion prompt has expired.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  if (interaction.user.id !== ctx.userId) {
    await interaction.reply({
      content: "This completion prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  const selected = interaction.values?.[0];
  const isOther = selected === "other";
  let platformId: number | null = null;
  if (!isOther) {
    const parsedId = Number(selected);
    if (Number.isInteger(parsedId)) {
      platformId = parsedId;
    }
  }
  const valid = isOther || (
    platformId !== null &&
    ctx.platforms.some((platform) => platform.id === platformId)
  );
  if (!valid) {
    await interaction.reply({
      content: "Invalid platform selection.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    return;
  }

  await interaction.deferUpdate().catch(() => {});
  completionPlatformSessions.delete(sessionId);

  if (isOther) {
    await notifyUnknownCompletionPlatform(interaction, ctx.gameTitle, ctx.gameId);
  }

  await saveCompletion(
    interaction,
    ctx.userId,
    ctx.gameId,
    platformId,
    ctx.completionType,
    ctx.completedAt,
    ctx.finalPlaytimeHours,
    ctx.note,
    ctx.gameTitle,
    ctx.announce,
    false,
    ctx.removeFromNowPlaying,
  );

  await interaction.editReply({ components: [] }).catch(() => {});
}

export async function resolveDefaultCompletionPlatformId(gameId: number): Promise<number | null> {
  const platforms = await Game.getPlatformsForGameWithStandard(
    gameId,
    STANDARD_PLATFORM_IDS,
  );
  return platforms[0]?.id ?? null;
}
