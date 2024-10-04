import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import { changelogText } from "../data/changelog.js";

@Discord()
export class todo {
  @Slash({ description: "RPGClubBotTS Development TODO List" })
  async todo(
    interaction: CommandInteraction,
  ): Promise<void> {
    if (changelogText) {
      outputChangelogAsEmbed(interaction, changelogText);
    }
  }
}

function outputChangelogAsEmbed(
  interaction: CommandInteraction, 
  changelogText: string
) {

  const fields = [];

  if (changelogText) {
    fields.push({
      name: 'Changelog',
      value: changelogText,
      inline: false,
    });
  }

  const changelogEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Bot Development Changelog`)
    .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/`)
    .setAuthor({
      name: 'RPGClubBotTs',
      iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
      url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
    })
    .setFields(fields);

  interaction.reply({ embeds: [changelogEmbed] });
}