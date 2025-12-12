import { Discord, SelectMenuComponent } from "discordx";
import { type StringSelectMenuInteraction, MessageFlags } from "discord.js";
import { handleIgdbSelectInteraction } from "../services/IgdbSelectService.js";

@Discord()
export class IgdbSelectHandler {
  @SelectMenuComponent({ id: /^igdb-select:.+/ })
  async handleIgdbSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const handled = await handleIgdbSelectInteraction(interaction);
    if (!handled && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "This IGDB selection is no longer valid.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}
