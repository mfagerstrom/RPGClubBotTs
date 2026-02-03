// Handlers for gotm-audit button/select/modal interactions

import type { ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction } from "discord.js";
import {
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { safeReply, safeUpdate, stripModalInput } from "../../functions/InteractionUtils.js";
import type { IGameWithPlatforms } from "../../classes/Game.js";
import Game from "../../classes/Game.js";
import {
  getGotmAuditImportById,
  getGotmAuditItemById,
  updateGotmAuditItem,
  setGotmAuditImportStatus,
} from "../../classes/GotmAuditImport.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { processNextGotmAuditItem, tryInsertGotmAuditRound } from "./gotm-audit.service.js";
import {
  GOTM_AUDIT_MANUAL_PREFIX,
  GOTM_AUDIT_MANUAL_INPUT_ID,
  GOTM_AUDIT_QUERY_PREFIX,
  GOTM_AUDIT_QUERY_INPUT_ID,
  GOTM_AUDIT_RESULT_LIMIT,
} from "./admin.types.js";
import {
  buildGotmAuditPromptContent,
  buildGotmAuditPromptContainer,
  buildGotmAuditPromptComponents,
} from "./gotm-audit-ui.service.js";

export async function handleGotmAuditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction
      .reply({
        content: "This audit prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await interaction
      .reply({
        content: "Invalid audit selection.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const selectedRaw = interaction.values?.[0];
  const gameDbId = Number(selectedRaw);
  if (!Number.isInteger(gameDbId) || gameDbId <= 0) {
    await interaction
      .reply({
        content: "Invalid GameDB selection.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await interaction.deferUpdate().catch(() => {});

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      content: "This audit session no longer exists.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      content: "This audit session is not active.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      content: "This audit item is no longer pending.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const game = await Game.getGameById(gameDbId);
  if (!game) {
    await safeReply(interaction, {
      content: `GameDB #${gameDbId} not found.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  await updateGotmAuditItem(itemId, {
    status: "IMPORTED",
    gameDbGameId: gameDbId,
    errorText: null,
  });

  await safeReply(interaction, {
    content: `Selected ${game.title} (GameDB #${gameDbId}).`,
    flags: MessageFlags.Ephemeral,
    __forceFollowUp: true,
  });

  await tryInsertGotmAuditRound(interaction, session, item);
  await processNextGotmAuditItem(interaction, session);
}

export async function handleGotmAuditAction(interaction: ButtonInteraction): Promise<void> {
  const [, ownerId, importIdRaw, itemIdRaw, action] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction
      .reply({
        content: "This audit prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await interaction
      .reply({
        content: "Invalid audit action.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  if (action === "manual") {
    const modal = new ModalBuilder()
      .setCustomId(`${GOTM_AUDIT_MANUAL_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setTitle("Manual GameDB Entry");
    const input = new TextInputBuilder()
      .setCustomId(GOTM_AUDIT_MANUAL_INPUT_ID)
      .setLabel("GameDB ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (action === "query") {
    const modal = new ModalBuilder()
      .setCustomId(`${GOTM_AUDIT_QUERY_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setTitle("Manual GameDB Search");
    const input = new TextInputBuilder()
      .setCustomId(GOTM_AUDIT_QUERY_INPUT_ID)
      .setLabel("Search query")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);
    await interaction.showModal(modal);
    return;
  }

  if (action === "accept") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This audit session no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This audit session is not active.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getGotmAuditItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This audit item is no longer pending.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let results: IGameWithPlatforms[] = [];
    try {
      results = await Game.searchGames(item.gameTitle);
    } catch (err: any) {
      await safeReply(interaction, {
        content: `GameDB search failed: ${err?.message ?? "Unknown error"}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const first = results[0];
    if (!first) {
      await safeReply(interaction, {
        content: "No GameDB matches found for this title.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    await updateGotmAuditItem(itemId, {
      status: "IMPORTED",
      gameDbGameId: first.id,
      errorText: null,
    });

    await safeReply(interaction, {
      content: `Selected ${first.title} (GameDB #${first.id}).`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });

    await tryInsertGotmAuditRound(interaction, session, item);
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  if (action === "skip") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This audit session no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (session.status !== "ACTIVE") {
      await safeReply(interaction, {
        content: "This audit session is not active.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const item = await getGotmAuditItemById(itemId);
    if (!item || item.importId !== session.importId || item.status !== "PENDING") {
      await safeReply(interaction, {
        content: "This audit item is no longer pending.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await updateGotmAuditItem(itemId, { status: "SKIPPED" });
    await safeUpdate(interaction, {
      content: `Skipped "${item.gameTitle}".`,
      components: [],
    });
    await processNextGotmAuditItem(interaction, session);
    return;
  }

  if (action === "pause") {
    const session = await getGotmAuditImportById(importId);
    if (!session || session.userId !== ownerId) {
      await safeReply(interaction, {
        content: "This audit session no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setGotmAuditImportStatus(session.importId, "PAUSED");
    await safeUpdate(interaction, {
      content: `Paused GOTM audit #${session.importId}.`,
      components: [],
    });
  }
}

export async function handleGotmAuditManualModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction
      .reply({
        content: "This audit prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await interaction
      .reply({
        content: "Invalid audit request.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const raw = interaction.fields.getTextInputValue(GOTM_AUDIT_MANUAL_INPUT_ID);
  const cleaned = stripModalInput(raw);
  const gameDbId = Number(cleaned);
  if (!Number.isInteger(gameDbId) || gameDbId <= 0) {
    await interaction
      .reply({
        content: "Please provide a valid GameDB id.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await interaction.deferUpdate().catch(() => {});

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      content: "This audit session no longer exists.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      content: "This audit session is not active.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      content: "This audit item is no longer pending.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const game = await Game.getGameById(gameDbId);
  if (!game) {
    await safeReply(interaction, {
      content: `GameDB #${gameDbId} not found.`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  await updateGotmAuditItem(itemId, {
    status: "IMPORTED",
    gameDbGameId: gameDbId,
    errorText: null,
  });

  await safeReply(interaction, {
    content: `Selected ${game.title} (GameDB #${gameDbId}).`,
    flags: MessageFlags.Ephemeral,
    __forceFollowUp: true,
  });

  await tryInsertGotmAuditRound(interaction, session, item);
  await processNextGotmAuditItem(interaction, session);
}

export async function handleGotmAuditQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [, ownerId, importIdRaw, itemIdRaw] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction
      .reply({
        content: "This audit prompt is not for you.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const importId = Number(importIdRaw);
  const itemId = Number(itemIdRaw);
  if (!Number.isInteger(importId) || !Number.isInteger(itemId)) {
    await interaction
      .reply({
        content: "Invalid audit request.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const raw = interaction.fields.getTextInputValue(GOTM_AUDIT_QUERY_INPUT_ID);
  const query = stripModalInput(raw).trim();
  if (!query) {
    await interaction
      .reply({
        content: "Please provide a search query.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  await interaction.deferUpdate().catch(() => {});

  const session = await getGotmAuditImportById(importId);
  if (!session || session.userId !== ownerId) {
    await safeReply(interaction, {
      content: "This audit session no longer exists.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  if (session.status !== "ACTIVE") {
    await safeReply(interaction, {
      content: "This audit session is not active.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const item = await getGotmAuditItemById(itemId);
  if (!item || item.importId !== session.importId || item.status !== "PENDING") {
    await safeReply(interaction, {
      content: "This audit item is no longer pending.",
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  let results: IGameWithPlatforms[] = [];
  try {
    results = await Game.searchGames(query);
  } catch (err: any) {
    await safeReply(interaction, {
      content: `GameDB search failed: ${err?.message ?? "Unknown error"}`,
      flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });
    return;
  }

  const options = results.slice(0, GOTM_AUDIT_RESULT_LIMIT).map((game) => {
    const year = game.initialReleaseDate instanceof Date
      ? game.initialReleaseDate.getFullYear()
      : game.initialReleaseDate
        ? new Date(game.initialReleaseDate).getFullYear()
        : null;
    const label = year ? `${game.title} (${year})` : game.title;
    return {
      id: game.id,
      label,
      description: `GameDB #${game.id}`,
    };
  });

  const baseContent = buildGotmAuditPromptContent(
    session,
    item,
    interaction.guildId ?? null,
    options.length > 0,
  );
  const content = `${baseContent}\n\nManual search: ${query}`;
  const container = buildGotmAuditPromptContainer(content);
  const components = buildGotmAuditPromptComponents(
    interaction.user.id,
    session.importId,
    item.itemId,
    options,
  );

  await safeReply(interaction, {
    components: [container, ...components],
    flags: buildComponentsV2Flags(true),
    __forceFollowUp: true,
  });
}
