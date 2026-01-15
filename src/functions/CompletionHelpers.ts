import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type CommandInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  type CompletionType,
  formatPlaytimeHours,
  formatTableDate,
} from "../commands/profile.command.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";

const ANNOUNCEMENT_CHANNEL_ID = "360819470836695042";

export async function saveCompletion(
  interaction: CommandInteraction | StringSelectMenuInteraction,
  userId: string,
  gameId: number,
  completionType: CompletionType,
  completedAt: Date | null,
  finalPlaytimeHours: number | null,
  note: string | null,
  gameTitle?: string,
  announce?: boolean,
  isAdminOverride: boolean = false,
  removeFromNowPlaying: boolean = true,
): Promise<void> {
  if (interaction.user.id !== userId && !isAdminOverride) {
    await interaction.followUp({
      content: "You can only log completions for yourself.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const game = await Game.getGameById(gameId);
  if (!game) {
    await interaction.followUp({
      content: `GameDB #${gameId} was not found.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await Member.addCompletion({
      userId,
      gameId,
      completionType,
      completedAt,
      finalPlaytimeHours,
      note,
    });
  } catch (err: any) {
    const msg = err?.message ?? "Failed to save completion.";
    await interaction.followUp({
      content: `Could not save completion: ${msg}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (removeFromNowPlaying) {
    try {
      await Member.removeNowPlaying(userId, gameId);
    } catch {
      // Ignore cleanup errors
    }
  }

  const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
  const details = [completionType, playtimeText].filter(Boolean).join(" — ");

  await interaction.followUp({
    content: `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
    flags: MessageFlags.Ephemeral,
  });

  if (announce) {
    try {
      const channel = await interaction.client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
      if (channel && "send" in channel) {
        // Fetch the user who actually completed the game, not necessarily the interaction user
        const user = await interaction.client.users.fetch(userId).catch(() => null);
        
        if (user) {
          const completions = await Game.getGameCompletions(gameId);
          const isFirst = completions.length === 1;

          const dateStr = completedAt ? formatTableDate(completedAt) : "No date";
          const hoursStr = playtimeText ? ` - ${playtimeText}` : "";
          
          let desc = `<@${user.id}> has added a game completion: **${game.title}** - ${completionType} - ${dateStr}${hoursStr}`;
          if (isAdminOverride && interaction.user.id !== userId) {
             desc = `<@${interaction.user.id}> added a game completion for <@${user.id}>: **${game.title}** - ${completionType} - ${dateStr}${hoursStr}`;
          }

          const embed = new EmbedBuilder()
            .setAuthor({
              name: user.displayName ?? user.username,
              iconURL: user.displayAvatarURL(),
            })
            .setDescription(desc)
            .setColor(0x00ff00);

          if (isFirst) {
            embed.addFields({
              name: "First Completion!",
              value: "This is the first recorded completion for this game in the club!",
            });
          }

          await (channel as any).send({
            embeds: [embed],
          });
        }
      }
    } catch (err) {
      console.error("Failed to announce completion:", err);
    }
  }
}

export async function promptRemoveFromNowPlaying(
  interaction: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  gameTitle: string,
): Promise<boolean> {
  const promptId = `np-remove:${interaction.user.id}:${Date.now()}`;
  const yesId = `${promptId}:yes`;
  const noId = `${promptId}:no`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(yesId)
      .setLabel("Yes")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(noId)
      .setLabel("No")
      .setStyle(ButtonStyle.Secondary),
  );

  const payload = {
    content: `Remove **${gameTitle}** from your Now Playing list?`,
    components: [row],
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  };

  let message: Message | null = null;
  try {
    if (interaction.deferred || interaction.replied) {
      const reply = await interaction.followUp(payload as any);
      message = reply as unknown as Message;
    } else {
      const reply = await interaction.reply(payload as any);
      message = reply as unknown as Message;
    }
  } catch {
    try {
      const reply = await interaction.followUp(payload as any);
      message = reply as unknown as Message;
    } catch {
      return false;
    }
  }

  if (!message || typeof message.awaitMessageComponent !== "function") {
    return false;
  }

  try {
    const selection = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(promptId),
      time: 120_000,
    });
    const remove = selection.customId.endsWith(":yes");
    await selection.update({
      content: remove
        ? "Okay, I'll remove it from Now Playing."
        : "Okay, I'll leave it in your Now Playing list.",
      components: [],
    }).catch(() => {});
    return remove;
  } catch {
    await message.edit({
      content: "No response received. Leaving it in your Now Playing list.",
      components: [],
    }).catch(() => {});
    return false;
  }
}
