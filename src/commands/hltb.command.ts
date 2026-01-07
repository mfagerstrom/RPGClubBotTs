import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { EmbedBuilder } from "discord.js";
import { searchHltb } from "../functions/SearchHltb.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

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
    @SlashOption({
      description: "If set to true, show the results in the channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    try {
      const result = await searchHltb(title);
      await outputHltbResultsAsEmbed(interaction, result, title, { ephemeral });
  } catch {
      await safeReply(interaction, {
        content: `Sorry, there was an error searching for "${title}". Please try again later.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  }
}

async function outputHltbResultsAsEmbed(
  interaction: CommandInteraction,
  result: any,
  hltbQuery: string,
  options: { ephemeral: boolean },
) {

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

    await safeReply(interaction, {
      embeds: [hltbEmbed],
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  } else {
    await safeReply(interaction, {
      content: `Sorry, no results were found for "${hltbQuery}"`,
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}
