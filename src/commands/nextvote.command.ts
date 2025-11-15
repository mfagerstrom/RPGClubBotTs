import { type CommandInteraction, EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";

@Discord()
export class NextVoteCommand {
  @Slash({
    description: "Show the date of the next GOTM/NR-GOTM vote",
    name: "nextvote",
  })
  async nextvote(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current || !current.nextVoteAt) {
        await safeReply(interaction, {
          content: "No next vote information is available.",
          ephemeral: true,
        });
        return;
      }

      let dateText: string;
      if (current.nextVoteAt instanceof Date) {
        dateText = current.nextVoteAt.toLocaleDateString();
      } else {
        const parsed = new Date(current.nextVoteAt as unknown as string);
        dateText = Number.isNaN(parsed.getTime())
          ? String(current.nextVoteAt)
          : parsed.toLocaleDateString();
      }

      const descriptionLines: string[] = [];
      descriptionLines.push(dateText);
      descriptionLines.push("");
      descriptionLines.push(
        "For nominations and discussion about the upcoming vote:",
      );
      descriptionLines.push(
        "- <#361717372970598401>",
      );
      descriptionLines.push(
        "- <#1148682094936064010>",
      );

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("Next Vote:")
        .setDescription(descriptionLines.join("\n"));

      await safeReply(interaction, {
        embeds: [embed],
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error fetching next vote information: ${msg}`,
        ephemeral: true,
      });
    }
  }
}
