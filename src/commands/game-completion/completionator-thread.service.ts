import type { CommandInteraction, Message, ThreadChannel } from "discord.js";
import { MessageFlags } from "discord.js";
import type { CompletionatorThreadContext, ICompletionatorImport } from "./completion.types.js";
import { completionatorThreadContexts } from "./completion.types.js";
import { getCompletionatorThreadKey } from "./completion-helpers.js";
import { CompletionatorUiService } from "./completionator-ui.service.js";
import { buildComponentsV2Flags } from "../../functions/NominationListComponents.js";
import { BOT_DEV_CHANNEL_ID } from "../../config/channels.js";
import { safeReply } from "../../functions/InteractionUtils.js";

export class CompletionatorThreadService {
  private uiService: CompletionatorUiService;

  constructor() {
    this.uiService = new CompletionatorUiService();
  }

  async getOrCreateCompletionatorThread(
    interaction: CommandInteraction,
    session: ICompletionatorImport,
  ): Promise<CompletionatorThreadContext | null> {
    const ephemeral = interaction.channel?.id !== BOT_DEV_CHANNEL_ID;
    const key: string = getCompletionatorThreadKey(session.userId, session.importId);
    const existing: CompletionatorThreadContext | undefined = completionatorThreadContexts.get(key);
    if (existing) {
      return existing;
    }

    const channel: any = interaction.channel;
    if (!channel || typeof channel.send !== "function") {
      await safeReply(interaction, {
        content: "Cannot create a thread in this channel.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return null;
    }

    if (channel.id === BOT_DEV_CHANNEL_ID) {
      const introLines = [
        `<@${session.userId}>`,
        `## Completionator Import #${session.importId}`,
        "Preparing import...",
      ];
      const wizardMessage: Message = await channel.send({
        components: this.uiService.buildCompletionatorComponents(introLines),
        files: [],
        flags: buildComponentsV2Flags(false),
      });
      const context: CompletionatorThreadContext = {
        userId: session.userId,
        importId: session.importId,
        threadId: channel.id,
        messageId: wizardMessage.id,
        thread: null,
        message: wizardMessage,
        parentMessage: null,
      };
      completionatorThreadContexts.set(key, context);
      return context;
    }

    if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
      const threadChannel: ThreadChannel = channel as ThreadChannel;
      const introLines = [
        `<@${session.userId}>`,
        `## Completionator Import #${session.importId}`,
        "Preparing import...",
      ];
      const wizardMessage: Message = await threadChannel.send({
        components: this.uiService.buildCompletionatorComponents(introLines),
        files: [],
        flags: buildComponentsV2Flags(false),
      });

      const context: CompletionatorThreadContext = {
        userId: session.userId,
        importId: session.importId,
        threadId: threadChannel.id,
        messageId: wizardMessage.id,
        thread: threadChannel,
        message: wizardMessage,
        parentMessage: null,
      };
      completionatorThreadContexts.set(key, context);
      return context;
    }

    const parentMessage: Message = await channel.send({
      content: `Completionator Import #${session.importId} started by <@${session.userId}>.`,
    });
    if (typeof parentMessage.startThread !== "function") {
      await safeReply(interaction, {
        content: "Thread creation is not supported in this channel.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return null;
    }

    const threadName: string = `Completionator Import #${session.importId}`;
    const thread: ThreadChannel = await parentMessage.startThread({
      name: threadName.slice(0, 100),
      autoArchiveDuration: 60,
    });

    const introLines = [
      `<@${session.userId}>`,
      `## Completionator Import #${session.importId}`,
      "Preparing import...",
    ];
    const wizardMessage: Message = await thread.send({
      components: this.uiService.buildCompletionatorComponents(introLines),
      files: [],
      flags: buildComponentsV2Flags(false),
    });

    const context: CompletionatorThreadContext = {
      userId: session.userId,
      importId: session.importId,
      threadId: thread.id,
      messageId: wizardMessage.id,
      thread: thread,
      message: wizardMessage,
      parentMessage: parentMessage,
    };
    completionatorThreadContexts.set(key, context);
    return context;
  }

  async cleanupCompletionatorThread(userId: string, importId: number): Promise<void> {
    const key = getCompletionatorThreadKey(userId, importId);
    const context = completionatorThreadContexts.get(key);
    if (!context) return;

    completionatorThreadContexts.delete(key);

    if (context.thread && "delete" in context.thread) {
      await context.thread.delete().catch(() => {});
    }
    if (context.parentMessage && "delete" in context.parentMessage) {
      await context.parentMessage.delete().catch(() => {});
    }
  }
}
