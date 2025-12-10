import {
  ApplicationCommandOptionType,
  CommandInteraction,
  PermissionsBitField,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { setThreadGameLink } from "../classes/Thread.js";
import { safeReply } from "../functions/InteractionUtils.js";

@Discord()
@SlashGroup({ description: "Thread admin commands", name: "thread" })
@SlashGroup("thread")
export class ThreadAdminCommands {
  @Slash({ description: "Link a thread to a GameDB game id", name: "link" })
  async link(
    @SlashOption({
      name: "thread_id",
      description: "Thread id to link",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    threadId: string,
    @SlashOption({
      name: "gamedb_game_id",
      description: "GameDB game id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    gamedbGameId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!this.hasManageThreads(interaction)) {
      await safeReply(interaction, {
        content: "You need Manage Threads permission to use this.",
        ephemeral: true,
      });
      return;
    }

    await setThreadGameLink(threadId, gamedbGameId);
    await safeReply(interaction, {
      content: `Linked thread ${threadId} to GameDB game ${gamedbGameId}.`,
      ephemeral: true,
    });
  }

  @Slash({ description: "Unlink a thread from a GameDB game id", name: "unlink" })
  async unlink(
    @SlashOption({
      name: "thread_id",
      description: "Thread id to unlink",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    threadId: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!this.hasManageThreads(interaction)) {
      await safeReply(interaction, {
        content: "You need Manage Threads permission to use this.",
        ephemeral: true,
      });
      return;
    }

    await setThreadGameLink(threadId, null);
    await safeReply(interaction, {
      content: `Unlinked thread ${threadId} from any GameDB game.`,
      ephemeral: true,
    });
  }

  private hasManageThreads(interaction: CommandInteraction): boolean {
    const member = interaction.member;
    if (!member || typeof member.permissions === "string") return false;
    return member.permissions.has(PermissionsBitField.Flags.ManageThreads);
  }
}
