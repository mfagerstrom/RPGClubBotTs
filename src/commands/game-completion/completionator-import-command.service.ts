import type { CommandInteraction, Attachment } from "discord.js";
import { MessageFlags, EmbedBuilder } from "discord.js";
import type { CompletionatorAction } from "./completion.types.js";
import { safeDeferReply, safeReply } from "../../functions/InteractionUtils.js";
import { fetchCsv, parseCompletionatorCsv } from "./completionator-parser.service.js";
import {
  createImportSession,
  insertImportItems,
  getActiveImportForUser,
  setImportStatus,
  countImportItems,
} from "../../classes/CompletionatorImport.js";
import { CompletionatorThreadService } from "./completionator-thread.service.js";
import { CompletionatorWorkflowService } from "./completionator-workflow.service.js";
import { BOT_DEV_CHANNEL_ID } from "../../config/channels.js";

export async function handleCompletionatorImport(
  interaction: CommandInteraction,
  action: CompletionatorAction,
  file: Attachment | undefined,
): Promise<void> {
  const ephemeral = interaction.channel?.id !== BOT_DEV_CHANNEL_ID;
  await safeDeferReply(interaction, {
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  });
  const userId = interaction.user.id;
  const guild = interaction.guild;

  if (!guild) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  if (action === "start") {
    if (!file?.url) {
      await safeReply(interaction, {
        content: [
          "Please attach the Completionator CSV file.",
          "To export it from Completionator:",
          "1. Open your Completionator profile",
          "2. Hover over 'Playthroughs' from the top menu and choose 'My Completions'",
          "3. In the upper-right, click 'Export' and then 'Export to CSV'",
          "4. Upload the CSV with `/game-completion import-completionator action:start file:<csv>`.",
        ].join("\n"),
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const csvText = await fetchCsv(file.url);
    if (!csvText) {
      await safeReply(interaction, {
        content: "Failed to download the CSV file.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const parsed = parseCompletionatorCsv(csvText);
    if (!parsed.length) {
      await safeReply(interaction, {
        content: "No rows found in the CSV file.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const session = await createImportSession({
      userId,
      totalCount: parsed.length,
      sourceFilename: file.name ?? null,
    });
    await insertImportItems(session.importId, parsed);

    const threadService = new CompletionatorThreadService();
    const context = await threadService.getOrCreateCompletionatorThread(interaction, session);
    if (!context) return;
    const threadMention: string = `<#${context.threadId}>`;

    await safeReply(interaction, {
      content:
        `Import session #${session.importId} created with ${parsed.length} rows. ` +
        `Starting review in ${threadMention}.`,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });

    const workflowService = new CompletionatorWorkflowService();
    await workflowService.processNextCompletionatorItem(interaction, session, {
      ephemeral,
      context,
    });
    return;
  }

  if (action === "status") {
    const session = await getActiveImportForUser(userId);
    if (!session) {
      await safeReply(interaction, {
        content: "No active import session found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const stats = await countImportItems(session.importId);
    const embed = new EmbedBuilder()
      .setTitle(`Completionator Import #${session.importId}`)
      .setDescription(`Status: ${session.status}`)
      .addFields(
        { name: "Pending", value: String(stats.pending), inline: true },
        { name: "Imported", value: String(stats.imported), inline: true },
        { name: "Updated", value: String(stats.updated), inline: true },
        { name: "Skipped", value: String(stats.skipped), inline: true },
        { name: "Errors", value: String(stats.error), inline: true },
      );

    await safeReply(interaction, {
      embeds: [embed],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  const session = await getActiveImportForUser(userId);
  if (!session) {
    await safeReply(interaction, {
      content: "No active import session found.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  if (action === "pause") {
    await setImportStatus(session.importId, "PAUSED");
    const threadService = new CompletionatorThreadService();
    await threadService.cleanupCompletionatorThread(session.userId, session.importId);
    await safeReply(interaction, {
      content:
        `Import #${session.importId} paused. ` +
        "Resume with `/game-completion import-completionator action:resume`.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  if (action === "cancel") {
    await setImportStatus(session.importId, "CANCELED");
    await safeReply(interaction, {
      content: `Import #${session.importId} canceled.`,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  await setImportStatus(session.importId, "ACTIVE");
  const threadService = new CompletionatorThreadService();
  const context = await threadService.getOrCreateCompletionatorThread(interaction, session);
  if (!context) return;
  await safeReply(interaction, {
    content:
      `Import #${session.importId} resumed. ` +
      `Continue in <#${context.threadId}>.`,
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  });

  const workflowService = new CompletionatorWorkflowService();
  await workflowService.processNextCompletionatorItem(interaction, session, {
    ephemeral,
    context,
  });
}
