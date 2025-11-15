import { ApplicationCommandOptionType, PermissionsBitField } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

@Discord()
@SlashGroup({ description: "Admin Commands", name: "admin" })
@SlashGroup("admin")
export class Admin {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be?",
      name: "text",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    text: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);

    if (okToUseCommand) {
      await setPresence(
        interaction,
        text
      );
      await safeReply(interaction, {
        content: `I'm now playing: ${text}!`
      });
    }
  }
}

export async function isAdmin(interaction: CommandInteraction) {
  // @ts-ignore
  const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

  if (!isAdmin) {
    await safeReply(interaction, {
      content: 'Access denied.  Command requires Administrator role.'
    });
  }

  return isAdmin;
}
