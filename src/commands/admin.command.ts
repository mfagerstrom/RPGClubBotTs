import { PermissionsBitField } from "discord.js";


import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash, SlashGroup } from "discordx";

@Discord()
@SlashGroup({ description: "Manage permissions", name: "admin" })
@SlashGroup("admin")
export class Admin {
  @Slash({ description: "Command A", name: "a" })
  async a(interaction: CommandInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);

    if (okToUseCommand) {
      await interaction.reply({
        content: 'You selected Command A.'
      });
    }
  }

  @Slash({ description: "Command B", name: "b" })
  async b(interaction: CommandInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);

    if (okToUseCommand) {
      await interaction.reply({
        content: 'You selected Command B.'
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