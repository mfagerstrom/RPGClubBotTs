import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
import { todoText } from "../data/todo.js";

@Discord()
export class todo {
  @Slash({ description: "RPGClubBotTS Development TODO List" })
  async todo(
    interaction: CommandInteraction,
  ): Promise<void> {
    if (todoText) {
      outputTodoAsEmbed(interaction, todoText);
    }
  }
}

function outputTodoAsEmbed(
  interaction: CommandInteraction, 
  todoText: string
) {
  const todoEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Bot Development TODO List`)
    .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/`)
    .setAuthor({
      name: 'RPGClubBotTs',
      iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
      url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
    })
    .setDescription(todoText);

  interaction.reply({ embeds: [todoEmbed] });
}