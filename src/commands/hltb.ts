import axios, { AxiosError } from 'axios';
import { EmbedBuilder } from "discord.js";

import type { Channel, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™" })
  async hltb(
    @SlashOption({
      description: "Enter game title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const hltb_query: string = title;
    const destination_channel = interaction.channel;

    const htmlData = fetchPage('https://howlongtobeat.com/game/10025');
    console.log(htmlData);

    // await hltbService.search(hltb_query).then(result => outputHltbResultsAsEmbed(interaction, result, destination_channel!, hltb_query));
  }
}

function fetchPage(url: string): Promise<string | undefined> {
  const HTMLData = axios
    .get(url)
    .then(res => res.data)
    .catch((error: AxiosError) => {
      if (error.config) {
        console.error(`There was an error with ${error.config.url}.`);
      }
      console.error(error.toJSON());
    });

  return HTMLData;
}


function outputHltbResultsAsEmbed(
  interaction: CommandInteraction,
  result: any,
  destination_channel: Channel,
  hltb_query: string) {

  if (result.length) {
    const hltb_result = result[0];

    const hltbEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`How Long to Beat ${hltb_result.name}`)
      .setURL(`https://howlongtobeat.com/game/${hltb_result.id}`)
      .setAuthor({
        name: 'HowLongToBeat™',
        iconURL: 'https://howlongtobeat.com/img/hltb_brand.png',
        url: 'https://howlongtobeat.com',
      })
      .setFields([
        {
          name: 'Main',
          value: `${hltb_result.gameplayMain} Hours`,
          inline: true,
        },
        {
          name: 'Main + Extra',
          value: `${hltb_result.gameplayMainExtra} Hours`,
          inline: true,
        },
        {
          name: 'Completionist',
          value: `${hltb_result.gameplayCompletionist} Hours`,
          inline: true,
        }
      ])
      .setImage(hltb_result.imageUrl);

    interaction.reply({ embeds: [hltbEmbed] });
  } else {
    interaction.reply(`Sorry, no results were found for "${hltb_query}"`);
  }
}