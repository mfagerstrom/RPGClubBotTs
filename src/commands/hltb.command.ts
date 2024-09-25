import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { EmbedBuilder } from "discord.js";

import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import UserAgent from 'user-agents';

@Discord()
export class hltb {
  @Slash({ description: "How Long to Beat™" })
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
    const hltbQuery: string = title;

    // search google for the title, using a site constraint
    const googleUrl = `https://www.google.com/search?q=site${encodeURI(':howlongtobeat.com')}+${encodeURI(hltbQuery)}`;

    // grab all the search result links
    const hltbUrlObjects = await axios.get(googleUrl, { responseEncoding: "latin1" })
      .then(({ data: html }) => {
        const $ = cheerio.load(html);
        const data = [...$(".egMi0")]
          .map(e => ({
            title: $(e).find("h3").text().trim(),
            href: $(e).find("a").attr("href"),
          }));
        return data;
      })
      .catch(err => console.error(err));

    // grab the first link of the bunch and pull out the id from it
    // @ts-ignore
    const hltbMessyUrl: string = hltbUrlObjects[0].href;
    const hltbId: string = hltbMessyUrl!.match(/\d+/)![0];
  
    // use the id to construct the hltb detail url
    const hltbGameUrl: string = `https://howlongtobeat.com/game/${hltbId}`;
    
    // and scrape it
    const hltbGameHTML: string = await fetchPage(hltbGameUrl);
    const $ = cheerio.load(hltbGameHTML);

    // grab the data that we need with cheerio
    const result = {
      name: $('.GameHeader_profile_header__q_PID').text().trim(),
      id: hltbId,
      main: $('h4:contains("Main Story")').next().text(),
      mainSides: $('h4:contains("Main + Sides")').next().text(),
      completionist: $('h4:contains("Completionist")').next().text(),
      singlePlayer: $('h4:contains("Single-Player")').next().text(),
      coOp: $('h4:contains("Co-Op")').next().text(),
      vs: $('h4:contains("Vs.")').next().text(),
      imageUrl: $('img').attr('src'),
    };

    console.log(result);

    // finally, render the data in an embed in discord
    outputHltbResultsAsEmbed(interaction, result, hltbQuery);
  }
}

async function fetchPage(url: string) {
  const HTMLData = await axios
    .get(url, {
      headers: {
        'User-Agent': new UserAgent().toString(),
        'origin': 'https://howlongtobeat.com',
        'referer': 'https://howlongtobeat.com'
      },
    })
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