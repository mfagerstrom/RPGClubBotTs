import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { searchHltb } from "../functions/SearchHltb.js";

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
    const result = await searchHltb(title)
    await interaction.reply({
        content: result.imageUrl,
      });
  }
}