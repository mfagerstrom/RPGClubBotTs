import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
import changelogJSON from "../data/changelog.json" assert { type: "json" };

@Discord()
export class changelog {
  @Slash({ description: "RPGClubBotTS Development Changelog" })
  async changelog(
    @SlashChoice({ name: "Latest Change (default)", value: "latest" })
    @SlashChoice({ name: "Last 3 Changes", value: "three" })
    @SlashChoice({ name: "All Changes", value: "all" })
    @SlashOption({
      description: "Output",
      name: "output",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    output: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    if (changelogJSON) {
      outputChangelogAsEmbed(interaction, changelogJSON, output);
    }
  }
}

async function outputChangelogAsEmbed(
  interaction: CommandInteraction,
  changelogJSON: ChangelogJSON[],
  output: string,
) {
  let embed: EmbedBuilder;
  let currentChange: ChangelogJSON;
  let description: string;

  let loopLength: number;
  switch (output) {
    case "latest":
      loopLength = 1;
      break;
    case "three":
      loopLength = 3;
      break;
    case "all":
      loopLength = changelogJSON.length;
      break;
    default:
      loopLength = 1;
  }

  for (let x: number = 0; x < loopLength; x++) {
    currentChange = changelogJSON[x];
    description = currentChange.changes.join("\n");

    embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`${currentChange.date} - v${currentChange.version}`)
      .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/`)
      .setAuthor({
        name: currentChange.author,
        iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
        url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
      })
      .setDescription(description);

    if (x === 0) await interaction.reply({ embeds: [embed] });
    // @ts-ignore
    else await interaction.channel.send({ embeds: [embed] });
  }
}

interface ChangelogJSON {
  version: string;
  date: string;
  changes: string[];
  author: string;
}