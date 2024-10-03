import { EmbedBuilder } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash } from "discordx";
// import { todoText } from "../data/todo";

@Discord()
export class todo {
  @Slash({ description: "RPGClubBotTS Development TODO List - Work In Progress, does nothing yet" })
  async todo(
    interaction: CommandInteraction,
  ): Promise<void> {
    /*
    if (todoText) {
      outputTodoAsEmbed(interaction, todoText);
    }
      */
  }
}

function outputTodoAsEmbed(
  interaction: CommandInteraction, 
  todoText: string
) {

  const fields = [];

  if (todoText) {
    fields.push({
      name: 'todo.md',
      value: todoText,
      inline: false,
    });
  }

  const todoEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Bot Development TODO List`)
    .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/blob/main/todo.md`)
    .setAuthor({
      name: 'RPGClubBotTs',
      iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
      url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
    })
    .setFields(fields);

  interaction.reply({ embeds: [todoEmbed] });
}