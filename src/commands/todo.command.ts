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

async function outputTodoAsEmbed(
  interaction: CommandInteraction,
  todoText: string,
) {

  let embed: EmbedBuilder;
  for (const i of Array(Math.ceil(todoText.length / 4096)).keys()) {
    if (i === 0) {
      embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`Bot Development TODO List`)
      .setURL(`https://github.com/mfagerstrom/RPGClubBotTs/`)
      .setAuthor({
        name: 'RPGClubBotTs',
        iconURL: 'https://cdn.discordapp.com/avatars/1154429583031025705/07cd692b5b2c8e5ad5b4d06ad166684c.webp?size=240',
        url: 'https://github.com/mfagerstrom/RPGClubBotTs/',
      })
      .setDescription(todoText.substring((i * 4096), (i * 4096) + 4096));
    } else {
      embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setDescription(todoText.substring((i * 4096), (i * 4096) + 4096));
    }
    
    if (i === 0) await interaction.reply({ embeds: [embed] })
    // @ts-ignore
    else await interaction.channel.send({ embeds: [embed] })
  }
}