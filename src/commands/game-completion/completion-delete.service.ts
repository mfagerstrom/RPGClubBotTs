import { MessageFlags, type StringSelectMenuInteraction } from "discord.js";
import Member from "../../classes/Member.js";

/**
 * Handles completion deletion from the selection menu
 */
export async function handleCompletionDeleteMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This delete prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const completionId = Number(interaction.values[0]);
  if (!Number.isInteger(completionId) || completionId <= 0) {
    await interaction.reply({
      content: "Invalid selection.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ok = await Member.deleteCompletion(ownerId, completionId);
  if (!ok) {
    await interaction.reply({
      content: "Completion not found or could not be deleted.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `Deleted completion #${completionId}.`,
    flags: MessageFlags.Ephemeral,
  });

  try {
    await interaction.message.edit({ components: [] }).catch(() => {});
  } catch {
    // ignore
  }
}
