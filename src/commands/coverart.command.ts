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
    await safeDeferReply(interaction, { ephemeral });

    try {
      const result = await searchHltb(title);
      if (result && result.imageUrl) {
        await safeReply(interaction, {
          content: result.imageUrl,
          ephemeral,
        });
      } else {
        await safeReply(interaction, {
          content: `Sorry, no cover art was found for "${title}".`,
          ephemeral,
        });
      }
    } catch (error) {
      await safeReply(interaction, {
        content: `Sorry, there was an error searching for cover art for "${title}". Please try again later.`,
        ephemeral,
      });
    }
  }
}
