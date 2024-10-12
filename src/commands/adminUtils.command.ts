import { PermissionsBitField } from "discord.js";


import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class AdminUtils {
  @Slash({ description: "Admin-only commands" })
  async admin_utils(
    interaction: CommandInteraction,
  ): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);

    if (okToUseCommand) {
      await interaction.reply({
        content: 'Nice.  You\'re in.'
      });
    }
  }
}

export async function isAdmin(interaction: CommandInteraction) {
  // @ts-ignore
  const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

  if (!isAdmin) {
    await interaction.reply({
      content: 'Access denied.  Command requires Administrator role.'
    });
  }

  return isAdmin;
}