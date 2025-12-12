import {
  ApplicationCommandOptionType,
  CommandInteraction,
  MessageFlags,
  PermissionsBitField,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { removeThreadGameLink, setThreadGameLink } from "../classes/Thread.js";
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await setThreadGameLink(threadId, gamedbGameId);
    await safeReply(interaction, {
              flags: MessageFlags.Ephemeral,    });
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
    @SlashOption({
      name: "gamedb_game_id",
      description: "Specific GameDB game id to unlink (omit to remove all)",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    gamedbGameId: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (!this.hasManageThreads(interaction)) {
      await safeReply(interaction, {
        content: "You need Manage Threads permission to use this.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const removed = await removeThreadGameLink(threadId, gamedbGameId);
    const target = gamedbGameId ? `GameDB game ${gamedbGameId}` : "all GameDB links";
    const suffix = removed === 0 ? " (no matching links were found)." : ".";
    await safeReply(interaction, {
      content: `Unlinked ${target} from thread ${threadId}${suffix}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  private hasManageThreads(interaction: CommandInteraction): boolean {
    const member = interaction.member;
    if (!member || typeof member.permissions === "string") return false;
    return member.permissions.has(PermissionsBitField.Flags.ManageThreads);
  }
}
