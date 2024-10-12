import { PermissionsBitField } from "discord.js";


import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";

@Discord()
export class Mod {
  @Slash({ description: "Moderator-only commands" })
  async mod(
    interaction: CommandInteraction,
  ): Promise<void> {
    const okToUseCommand: boolean = await isModerator(interaction);

    if (okToUseCommand) {
      await interaction.reply({
        content: 'Nice.  You\'re in.'
      });
    }
  }
}

export async function isModerator(interaction: CommandInteraction) {
  // @ts-ignore
  let isMod = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages);

  if (!isMod) {
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

    if (!isAdmin) {
      await interaction.reply({
        content: 'Access denied.  Command requires Moderator role or above.'
      });
    } else {
      isMod = true;
    }
  }

  return isMod;
}