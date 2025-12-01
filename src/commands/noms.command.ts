import type { CommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import { listNominationsForRound } from "../classes/Nomination.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

@Discord()
export class CombinedNoms {
  @Slash({
    description: "Show both GOTM and NR-GOTM nominations for the upcoming round",
    name: "noms",
  })
  async noms(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const window = await getUpcomingNominationWindow();
      const voteLabel = formatDate(window.nextVoteAt);

      const [gotm, nrGotm] = await Promise.all([
        listNominationsForRound("gotm", window.targetRound),
        listNominationsForRound("nr-gotm", window.targetRound),
      ]);

      const embeds: EmbedBuilder[] = [];

      embeds.push(
        buildListEmbed({
          title: `GOTM Nominations - Round ${window.targetRound}`,
          nominations: gotm,
          voteDate: voteLabel,
          command: "/gotm nominate",
        }),
      );

      embeds.push(
        buildListEmbed({
          title: `NR-GOTM Nominations - Round ${window.targetRound}`,
          nominations: nrGotm,
          voteDate: voteLabel,
          command: "/nr-gotm nominate",
        }),
      );

      await safeReply(interaction, { embeds });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not load nominations: ${msg}`,
      });
    }
  }
}

function buildListEmbed(opts: {
  title: string;
  nominations: Awaited<ReturnType<typeof listNominationsForRound>>;
  voteDate: string;
  command: string;
}): EmbedBuilder {
  const lines =
    opts.nominations.length > 0
      ? opts.nominations.map((n, idx) => `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>`)
      : ["No nominations yet."];

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(opts.title)
    .setDescription(lines.join("\n"))
    .setFooter({
      text:
        `Vote on ${opts.voteDate}\n` +
        `Do you want to nominate a game? Use ${opts.command}`,
    });
}

function numberEmoji(n: number): string {
  const lookup: Record<number, string> = {
    1: ":one:",
    2: ":two:",
    3: ":three:",
    4: ":four:",
    5: ":five:",
    6: ":six:",
    7: ":seven:",
    8: ":eight:",
    9: ":nine:",
    10: ":keycap_ten:",
  };
  return lookup[n] ?? `${n}.`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}
