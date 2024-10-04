import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import { changelogText } from "../data/changelog.js";

@Discord()
export class changelog {
  @Slash({ description: "RPGClubBotTS Development Changelog" })
  async changelog(
    interaction: CommandInteraction,
  ): Promise<void> {
    if (changelogText) {
      outputChangelogAsEmbed(interaction, changelogText);
    }
  }
}

async function outputChangelogAsEmbed(
  interaction: CommandInteraction,
  changelogText: string
) {
  let embed: EmbedBuilder;
  for (const i of Array(Math.ceil(changelogText.length / 4096)).keys()) {
    if (i === 0) {
      embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`Bot Development Changelog`)
        .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/`)
        .setAuthor({
          name: 'RPGClubBotTs',
          iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
          url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
        })
        .setDescription(changelogText);
    } else {
      embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setDescription(changelogText.substring((i * 4096), (i * 4096) + 4096));
    }
    
    if (i === 0) await interaction.reply({ embeds: [embed] });
      // @ts-ignore
      else await interaction.channel.send({ embeds: [embed] });
  }
}