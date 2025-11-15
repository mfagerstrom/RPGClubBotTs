import type { CommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

@Discord()
export class BotHelp {
  @Slash({ description: "Show help for all bot commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const embed = new EmbedBuilder()
      .setTitle("RPG Club Bot Help")
      .setDescription("Summary of available slash commands")
      .addFields(
        {
          name: "/gotm",
          value:
            "Search Game of the Month (GOTM) data.\n" +
            "Syntax: /gotm [round:<integer>] [year:<integer>] [month:<string>] [title:<string>]\n" +
            "Notes: If round is provided, it takes precedence. year+month target a specific month. title searches by game title.",
        },
        {
          name: "/nr-gotm",
          value:
            "Search Non-RPG Game of the Month (NR-GOTM) data.\n" +
            "Syntax: /nr-gotm [round:<integer>] [year:<integer>] [month:<string>] [title:<string>]\n" +
            "Notes: If round is provided, it takes precedence. year+month target a specific month. title searches by game title.",
        },
        {
          name: "/hltb",
          value:
            "Search HowLongToBeat for game completion times.\n" +
            "Syntax: /hltb title:<string>\n" +
            "Parameters: title (required string) - game title and optional descriptors.",
        },
        {
          name: "/coverart",
          value:
            "Search for video game cover art using Google/HLTB data.\n" +
            "Syntax: /coverart title:<string>\n" +
            "Parameters: title (required string) - game title and optional descriptors.",
        },
        {
          name: "/admin ... (Admin only)",
          value:
            "Admin-only commands for managing bot presence and GOTM/NR-GOTM data.\n" +
            "Use /admin help for a detailed list of admin subcommands, their syntax, and parameters.",
        },
        {
          name: "/mod ... (Moderator or above)",
          value:
            "Moderator commands for managing bot presence and NR-GOTM data.\n" +
            "Use /mod help for a detailed list of moderator subcommands, their syntax, and parameters.",
        },
      );

    await safeReply(interaction, {
      embeds: [embed],
    });
  }
}
