import { type CommandInteraction, EmbedBuilder, ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import {
  buildGotmEntryEmbed,
  buildNrGotmEntryEmbed,
} from "../functions/GotmEntryEmbeds.js";

@Discord()
export class CurrentRoundCommand {
  @Slash({
    description: "Show the current GOTM round and winners",
    name: "round",
  })
  async round(
    @SlashOption({
      description: "If true, show results in the channel instead of ephemerally.",
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
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content: "No voting round information is available.",
          ephemeral: true,
        });
        return;
      }

      const roundNumber = current.roundNumber;

      const gotmEntries = Gotm.getByRound(roundNumber);
      const nrGotmEntries = NrGotm.getByRound(roundNumber);

      const gotmMonthYear = gotmEntries[0]?.monthYear;
      const nrGotmMonthYear = nrGotmEntries[0]?.monthYear;

      const hasGotm = gotmEntries.length > 0;
      const hasNrGotm = nrGotmEntries.length > 0;

      const currentDescLines: string[] = [];
      let mainLine = `Round ${roundNumber}`;

      if (gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear) {
        mainLine += ` - ${gotmMonthYear}`;
      }

      currentDescLines.push(mainLine);

      if (!gotmMonthYear && !nrGotmMonthYear) {
        // no extra month/year lines
      } else if (!(gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear)) {
        if (gotmMonthYear) {
          currentDescLines.push(`GOTM: ${gotmMonthYear}`);
        }
        if (nrGotmMonthYear) {
          currentDescLines.push(`NR-GOTM: ${nrGotmMonthYear}`);
        }
      }

      if (!hasGotm && !hasNrGotm) {
        currentDescLines.push("");
        currentDescLines.push("(No GOTM or NR-GOTM entries found for this round.)");
      }

      const currentEmbed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Current Round:")
        .setDescription(currentDescLines.join("\n"));

      const embeds: EmbedBuilder[] = [currentEmbed];
      const files: any[] = [];

      if (hasGotm) {
        const gotmEntry = gotmEntries[0];
        const gotmAssets = await buildGotmEntryEmbed(
          gotmEntry,
          interaction.guildId ?? undefined,
          interaction.client as any,
        );
        const gotmEmbed = gotmAssets.embed;
        gotmEmbed.setTitle("Game of the Month");
        // Ensure the title is not a clickable link
        gotmEmbed.setURL(null as any);
        embeds.push(gotmEmbed);

        if (gotmAssets.files?.length) {
          files.push(...gotmAssets.files);
        }

        if (gotmAssets.files?.length === 1 || gotmEmbed.toJSON().thumbnail?.url) {
          const thumbFromEmbed: string | undefined = gotmEmbed.toJSON().thumbnail?.url;
          const imageUrl =
            (gotmAssets.files && gotmAssets.files.length > 0
              ? `attachment://${gotmAssets.files[0].name}`
              : thumbFromEmbed) ?? undefined;
          gotmEmbed.setThumbnail(null as any);
          if (imageUrl) {
            gotmEmbed.setImage(imageUrl);
          }
        }
      }

      if (hasNrGotm) {
        const nrIGotmEntry = nrGotmEntries[0];
        const nrAssets = await buildNrGotmEntryEmbed(
          nrIGotmEntry,
          interaction.guildId ?? undefined,
          interaction.client as any,
        );
        const nrEmbed = nrAssets.embed;
        nrEmbed.setTitle("Non-RPG Game of the Month");
        // Ensure the title is not a clickable link
        nrEmbed.setURL(null as any);
        embeds.push(nrEmbed);

        if (nrAssets.files?.length) {
          files.push(...nrAssets.files);
        }

        if (nrAssets.files?.length === 1 || nrEmbed.toJSON().thumbnail?.url) {
          const thumbFromEmbed: string | undefined = nrEmbed.toJSON().thumbnail?.url;
          const imageUrl =
            (nrAssets.files && nrAssets.files.length > 0
              ? `attachment://${nrAssets.files[0].name}`
              : thumbFromEmbed) ?? undefined;
          nrEmbed.setThumbnail(null as any);
          if (imageUrl) {
            nrEmbed.setImage(imageUrl);
          }
        }
      }

      await safeReply(interaction, {
        embeds,
        files: files.length ? files : undefined,
        ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error fetching current round information: ${msg}`,
        ephemeral: true,
      });
    }
  }
}
