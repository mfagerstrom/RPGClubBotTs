import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { searchHltb } from "../functions/SearchHltb.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

@Discord()
export class Coverart {
  @Slash({ description: "Video Game Cover Art search, courtesy of Google and HLTB" })
  async coverart(
    @SlashOption({
      description: "Enter game title and optional descriptors (we're googling!)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const result = await searchHltb(title);
      if (result && result.imageUrl) {
        await safeReply(interaction, {
          content: result.imageUrl,
        });
      } else {
        await safeReply(interaction, {
          content: `Sorry, no cover art was found for "${title}".`,
        });
      }
    } catch (error) {
      await safeReply(interaction, {
        content: `Sorry, there was an error searching for cover art for "${title}". Please try again later.`,
      });
    }
  }
}
