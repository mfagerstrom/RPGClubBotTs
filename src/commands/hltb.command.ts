import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { EmbedBuilder } from "discord.js";
import { searchHltb } from "../functions/SearchHltb.js";

@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™ Search" })
  async hltb(
    @SlashOption({
      description: "Enter game title and optional descriptors (we're googling!)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const result = await searchHltb(title)
    outputHltbResultsAsEmbed(interaction, result, title);
  }
}

function outputHltbResultsAsEmbed(
  interaction: CommandInteraction,
  result: any,
  hltbQuery: string) {

  if (result) {
    const hltb_result = result;

    const fields = [];

    if (hltb_result.singlePlayer) {
      fields.push({
        name: 'Single-Player',
        value: hltb_result.singlePlayer,
        inline: true,
      });
    }

    if (hltb_result.coOp) {
      fields.push({
        name: 'Co-Op',
        value: hltb_result.coOp,
        inline: true,
      });
    }

    if (hltb_result.vs) {
      fields.push({
        name: 'Vs.',
        value: hltb_result.vs,
        inline: true,
      });
    }

    if (hltb_result.main) {
      fields.push({
        name: 'Main',
        value: hltb_result.main,
        inline: true,
      });
    }

    if (hltb_result.mainSides) {
      fields.push({
        name: 'Main + Sides',
        value: hltb_result.mainSides,
        inline: true,
      });
    }

    if (hltb_result.completionist) {
      fields.push({
        name: 'Completionist',
        value: hltb_result.completionist,
        inline: true,
      });
    }
    

    const hltbEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`How Long to Beat ${hltb_result.name}`)
      .setURL(`https://howlongtobeat.com/game/${hltb_result.id}`)
      .setAuthor({
        name: 'HowLongToBeat™',
        iconURL: 'https://howlongtobeat.com/img/hltb_brand.png',
        url: 'https://howlongtobeat.com',
      })
      .setFields(fields)
      .setImage(hltb_result.imageUrl);

    interaction.reply({ embeds: [hltbEmbed] });
  } else {
    interaction.reply(`Sorry, no results were found for "${hltbQuery}"`);
  }
}