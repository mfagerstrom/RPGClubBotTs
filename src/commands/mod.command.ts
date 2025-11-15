import { ApplicationCommandOptionType, PermissionsBitField } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

@Discord()
@SlashGroup({ description: "Moderator Commands", name: "mod" })
@SlashGroup("mod")
export class Mod {
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

    const okToUseCommand: boolean = await isModerator(interaction);

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

// @Discord()
// export class Mod {
//   @Slash({ description: "Moderator-only commands" })
//   async mod(
//     interaction: CommandInteraction,
//   ): Promise<void> {
//     const okToUseCommand: boolean = await isModerator(interaction);

//     if (okToUseCommand) {
//       await interaction.reply({
//         content: 'Nice.  You\'re in.'
//       });
//     }
//   }
// }

export async function isModerator(interaction: CommandInteraction) {
  // @ts-ignore
  let isMod = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages);

  if (!isMod) {
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

    if (!isAdmin) {
      await safeReply(interaction, {
        content: 'Access denied.  Command requires Moderator role or above.'
      });
    } else {
      isMod = true;
    }
  }

  return isMod;
}
