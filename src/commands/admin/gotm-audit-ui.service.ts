import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { ContainerBuilder, TextDisplayBuilder } from "@discordjs/builders";
import { type IGotmAuditImport, type IGotmAuditItem } from "../../classes/GotmAuditImport.js";
import {
  GOTM_AUDIT_SELECT_PREFIX,
  GOTM_AUDIT_ACTION_PREFIX,
  GOTM_AUDIT_RESULT_LIMIT,
} from "./admin.types.js";

export function buildGotmAuditPromptContent(
  session: IGotmAuditImport,
  item: IGotmAuditItem,
  hasResults: boolean,
): string {
  const kindLabel = item.kind === "nr-gotm" ? "NR-GOTM" : "GOTM";
  const threadText = item.threadId ? `<#${item.threadId}>` : "None";
  const redditText = item.redditUrl ?? "None";
  const base =
    `## ${kindLabel} Audit #${session.importId} - Item ${item.rowIndex}/${session.totalCount}\n` +
    `**Round:** ${item.roundNumber}\n` +
    `**Month/Year:** ${item.monthYear}\n` +
    `**Game Index:** ${item.gameIndex + 1}\n` +
    `**Title:** ${item.gameTitle}\n` +
    `**Thread:** ${threadText}\n` +
    `**Reddit:** ${redditText}`;

  if (hasResults) {
    return `${base}\n\nSelect a GameDB match or choose Manual GameDB ID.`;
  }

  return `${base}\n\nNo GameDB matches found. Use Manual GameDB Search or Skip.`;
}

export function buildGotmAuditPromptContainer(content: string): ContainerBuilder {
  const container = new ContainerBuilder();
  const safeContent = content.length > 4000 ? `${content.slice(0, 3997)}...` : content;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(safeContent),
  );
  return container;
}

export function buildGotmAuditPromptComponents(
  ownerId: string,
  importId: number,
  itemId: number,
  options: Array<{ id: number; label: string; description?: string }>,
): ActionRowBuilder<any>[] {
  const rows: ActionRowBuilder<any>[] = [];

  if (options.length) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${GOTM_AUDIT_SELECT_PREFIX}:${ownerId}:${importId}:${itemId}`)
      .setPlaceholder("Select a GameDB match")
      .addOptions(
        options.slice(0, GOTM_AUDIT_RESULT_LIMIT).map((opt, idx) => ({
          label: opt.label.slice(0, 100),
          value: String(opt.id),
          description: opt.description?.slice(0, 100),
          default: idx === 0,
        })),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:manual`)
      .setLabel("Manual GameDB ID")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:query`)
      .setLabel("Manual GameDB Search")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:accept`)
      .setLabel("Accept First Option")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!options.length),
  );
  const controlRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:skip`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${GOTM_AUDIT_ACTION_PREFIX}:${ownerId}:${importId}:${itemId}:pause`)
      .setLabel("Pause")
      .setStyle(ButtonStyle.Secondary),
  );

  rows.push(actionRow, controlRow);
  return rows;
}
