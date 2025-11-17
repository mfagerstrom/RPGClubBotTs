import type { CommandInteraction, Client, TextBasedChannel } from "discord.js";
import { ApplicationCommandOptionType, EmbedBuilder } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
// Use relative import with .js for ts-node ESM compatibility
import Gotm, { GotmEntry, GotmGame } from "../classes/Gotm.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import {
  areNominationsClosed,
  getUpcomingNominationWindow,
} from "../functions/NominationWindow.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
  upsertNomination,
} from "../classes/Nomination.js";
import { GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";

const ANNOUNCEMENTS_CHANNEL_ID: string | undefined = process.env.ANNOUNCEMENTS_CHANNEL_ID;

// Precompute dropdown choices
const MONTH_CHOICES = [
  { name: "January", value: "January" },
  { name: "February", value: "February" },
  { name: "March", value: "March" },
  { name: "April", value: "April" },
  { name: "May", value: "May" },
  { name: "June", value: "June" },
  { name: "July", value: "July" },
  { name: "August", value: "August" },
  { name: "September", value: "September" },
  { name: "October", value: "October" },
  { name: "November", value: "November" },
  { name: "December", value: "December" },
] as const;

const YEAR_CHOICES = (() => {
  try {
    const entries = Gotm.all();
    const years = Array.from(
      new Set(
        entries
          .map((e) => {
            const m = e.monthYear.match(/(\d{4})$/);
            return m ? Number(m[1]) : null;
          })
          .filter((n): n is number => n !== null)
      )
    ).sort((a, b) => b - a);
    return years.map((y) => ({ name: y.toString(), value: y }));
  } catch {
    return [] as { name: string; value: number }[];
  }
})();

@Discord()
@SlashGroup({ description: "Game of the Month commands", name: "gotm" })
@SlashGroup("gotm")
export class GotmSearch {
  @Slash({ description: "Search Game of the Month (GOTM)", name: "search" })
  async search(
    @SlashOption({
      description: "Round number (takes precedence if provided)",
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number | undefined,
    @SlashChoice(...YEAR_CHOICES as any)
    @SlashOption({
      description: "Year (e.g., 2023). Use with month for specific month.",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | undefined,
    @SlashChoice(...MONTH_CHOICES as any)
    @SlashOption({
      description: "Month name or number (e.g., March or 3). Requires year.",
      name: "month",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    month: string | undefined,
  @SlashOption({
    description: "Search by title substring",
    name: "title",
    required: false,
    type: ApplicationCommandOptionType.String,
  })
  title: string | undefined,
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
    // Acknowledge early to avoid interaction timeouts while fetching images
    await safeDeferReply(interaction, { ephemeral });

    // Determine search mode
    let results: GotmEntry[] = [];
    let criteriaLabel: string | undefined;

    try {
      if (round !== undefined && round !== null) {
        results = Gotm.getByRound(Number(round));
        criteriaLabel = `Round ${round}`;
      } else if (title && title.trim().length > 0) {
        results = Gotm.searchByTitle(title);
        criteriaLabel = `Title contains "${title}"`;
      } else if (year !== undefined && year !== null) {
        if (month && month.trim().length > 0) {
          const monthValue = parseMonthValue(month);
          results = Gotm.getByYearMonth(Number(year), monthValue);
          const monthLabel = typeof monthValue === 'number' ? monthValue.toString() : monthValue;
          criteriaLabel = `Year ${year}, Month ${monthLabel}`;
        } else {
          results = Gotm.getByYear(Number(year));
          criteriaLabel = `Year ${year}`;
        }
      } else {
        // Default: show current round (highest round number in data)
        const all = Gotm.all();
        if (!all.length) {
          await safeReply(interaction, { content: "No GOTM data available.", ephemeral: true });
          return;
        }
        const currentRound = Math.max(...all.map((e) => e.round));
        results = Gotm.getByRound(currentRound);
        // no criteriaLabel so the embed omits the query line
      }

      if (!results || results.length === 0) {
        await safeReply(interaction, { content: `No GOTM entries found for ${criteriaLabel}.`, ephemeral: true });
        return;
      }

      const embeds = await buildGotmEmbeds(results, criteriaLabel, interaction.guildId ?? undefined, interaction.client);
      const content = criteriaLabel ? `Query: "${criteriaLabel}"` : undefined;
      if (embeds.length <= 10) {
        await safeReply(interaction, { content, embeds, ephemeral });
      } else {
        const chunks = chunkEmbeds(embeds, 10);
        await safeReply(interaction, { content, embeds: chunks[0], ephemeral });
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp({ embeds: chunks[i], ephemeral });
        }
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, { content: `Error processing request: ${msg}`, ephemeral: true });
    }
  }

  @Slash({
    description: "Nominate a game for the upcoming GOTM round",
    name: "nominate",
  })
  async nominate(
    @SlashOption({
      description: "Game title to nominate",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const cleaned = title?.trim();
    if (!cleaned) {
      await safeReply(interaction, {
        content: "Please provide a non-empty game title to nominate.",
        ephemeral: true,
      });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
        await safeReply(interaction, {
          content:
            `Nominations for Round ${window.targetRound} are closed. ` +
            `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
          ephemeral: true,
        });
        return;
      }

      const userId = interaction.user.id;
      const existing = await getNominationForUser("gotm", window.targetRound, userId);
      const saved = await upsertNomination("gotm", window.targetRound, userId, cleaned);

      const replaced =
        existing && existing.gameTitle !== saved.gameTitle
          ? ` (replaced "${existing.gameTitle}")`
          : existing
            ? " (no change to title)"
            : "";

      await safeReply(interaction, {
        content:
          `${existing ? "Updated" : "Recorded"} your GOTM nomination for Round ${
            window.targetRound
          }: "${saved.gameTitle}".${replaced}`,
        ephemeral: true,
      });

      const nominations = await listNominationsForRound("gotm", window.targetRound);
      const embed = buildNominationEmbed(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
      );
      const content = `<@${interaction.user.id}> nominated "${saved.gameTitle}" for GOTM Round ${window.targetRound}.`;
      await announceNomination("GOTM", interaction, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not save your nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "Delete your GOTM nomination for the upcoming round",
    name: "delete-nomination",
  })
  async deleteNomination(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
      await safeReply(interaction, {
        content:
          `Nominations for Round ${window.targetRound} are closed. ` +
            `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
        ephemeral: true,
      });
        return;
      }

      const userId = interaction.user.id;
      const existing = await getNominationForUser("gotm", window.targetRound, userId);
      if (!existing) {
        await safeReply(interaction, {
          content: `You do not have a GOTM nomination for Round ${window.targetRound}.`,
          ephemeral: true,
        });
        return;
      }

      await deleteNominationForUser("gotm", window.targetRound, userId);
      const nominations = await listNominationsForRound("gotm", window.targetRound);
      await safeReply(interaction, {
        content: `Deleted your GOTM nomination for Round ${window.targetRound}: "${existing.gameTitle}".`,
        ephemeral: true,
      });

      const embed = buildNominationEmbed(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
      );
      const content = `<@${interaction.user.id}> removed their GOTM nomination "${existing.gameTitle}" for GOTM Round ${window.targetRound}.`;
      await announceNomination("GOTM", interaction, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not delete your nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "List current GOTM nominations for the upcoming round",
    name: "noms",
  })
  async listNominations(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const window = await getUpcomingNominationWindow();
      const nominations = await listNominationsForRound("gotm", window.targetRound);
      const embed = buildNominationEmbed(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
      );
      await safeReply(interaction, { embeds: [embed] });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not list nominations: ${msg}`,
      });
    }
  }
}

function buildNominationEmbed(
  kindLabel: string,
  commandLabel: string,
  window: { closesAt: Date; nextVoteAt: Date; targetRound: number },
  nominations: Awaited<ReturnType<typeof listNominationsForRound>>,
): EmbedBuilder {
  const lines =
    nominations.length > 0
      ? nominations.map((n, idx) => `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>`)
      : ["No nominations yet."];

  const closesLabel = formatCloseLabel(window.closesAt);
  const voteLabel = formatDate(window.nextVoteAt);

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${kindLabel} Nominations - Round ${window.targetRound}`)
    .setDescription(lines.join("\n"))
    .setFooter({
      text:
        `Closes ${closesLabel} • Vote on ${voteLabel}\n` +
        `Do you want to nominate a game? Use ${commandLabel}`,
    });
}

async function announceNomination(
  kindLabel: string,
  interaction: CommandInteraction,
  content: string,
  embed: EmbedBuilder,
): Promise<void> {
  const channelId = GOTM_NOMINATION_CHANNEL_ID;
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased() ? (channel as TextBasedChannel) : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) return;
    await textChannel.send({ content, embeds: [embed] });
  } catch (err) {
    console.error(`Failed to announce ${kindLabel} nomination in channel ${channelId}:`, err);
  }
}

type SendableTextChannel = TextBasedChannel & {
  send: (content: any) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
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

function formatCloseLabel(date: Date): string {
  // Show close date (day before vote) at 11 PM ET.
  const datePart = formatDate(date);
  return `${datePart} 11:00 PM ET`;
}

function parseMonthValue(input: string): number | string {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= 12) return num;
  return trimmed;
}

async function buildGotmEmbeds(
  results: GotmEntry[],
  criteriaLabel: string | undefined,
  guildId: string | undefined,
  client: Client,
): Promise<EmbedBuilder[]> {
  // If many results, fall back to compact, field-based embeds (no thumbnails)
  if (results.length > 12) {
    return buildCompactEmbeds(results, criteriaLabel, guildId);
  }

  const embeds: EmbedBuilder[] = [];
  for (const entry of results) {
    const desc = formatGamesWithJump(entry, guildId);
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle(`Round ${entry.round} - ${entry.monthYear}`)
      .setDescription(desc);

    // Find first available thread image among this entry's games
    for (const g of entry.gameOfTheMonth) {
      if (!g.threadId) continue;
      const imgUrl = await resolveThreadImageUrl(client, g.threadId).catch(() => undefined);
      if (imgUrl) {
        embed.setThumbnail(imgUrl);
        break;
      }
    }

    embeds.push(embed);
  }

  return embeds;
}

function buildCompactEmbeds(results: GotmEntry[], criteriaLabel: string | undefined, guildId?: string): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  const MAX_FIELDS = 25;

  const baseEmbed = new EmbedBuilder().setColor(0x0099ff).setTitle("GOTM Search Results");

  let current = baseEmbed;
  let fieldCount = 0;
  for (const entry of results) {
    const name = `Round ${entry.round} - ${entry.monthYear}`;
    const value = formatGamesWithJump(entry, guildId);
    if (fieldCount >= MAX_FIELDS) {
      embeds.push(current);
      current = new EmbedBuilder().setColor(0x0099ff).setTitle("GOTM Search Results (cont.)");
      fieldCount = 0;
    }
    current.addFields({ name, value, inline: false });
    fieldCount++;
  }
  embeds.push(current);
  return embeds;
}

// Heavily inspired by ThreadCreated.command.ts logic, simplified for lookups
async function resolveThreadImageUrl(client: Client, threadId: string): Promise<string | undefined> {
  try {
    const channel = await client.channels.fetch(threadId);
    const anyThread = channel as any;
    if (!anyThread || typeof anyThread.fetchStarterMessage !== 'function') return undefined;
    const starter = await anyThread.fetchStarterMessage().catch(() => null);
    if (!starter) return undefined;

    // attachments first
    for (const att of starter.attachments?.values?.() ?? []) {
      const anyAtt: any = att as any;
      const nameLc = (anyAtt.name ?? '').toLowerCase();
      const ctype = (anyAtt.contentType ?? '').toLowerCase();
      if (ctype.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) || anyAtt.width) {
        return anyAtt.url ?? anyAtt.proxyURL;
      }
    }
    // embeds images and thumbnails (consider proxy urls)
    for (const emb of starter.embeds ?? []) {
      const anyEmb: any = emb as any;
      const imgUrl: string | undefined = emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
      const thumbUrl: string | undefined = emb.thumbnail?.url || anyEmb?.thumbnail?.proxyURL || anyEmb?.thumbnail?.proxy_url;
      if (imgUrl) return imgUrl;
      if (thumbUrl) return thumbUrl;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function chunkEmbeds(list: EmbedBuilder[], size: number): EmbedBuilder[][] {
  const out: EmbedBuilder[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function displayAuditValue(value: string | null | undefined): string | null {
  if (value === AUDIT_NO_VALUE_SENTINEL) return null;
  return value ?? null;
}

function formatGames(games: GotmGame[], guildId?: string): string {
  if (!games || games.length === 0) return "(no games listed)";
  const lines: string[] = [];
  for (const g of games) {
    const parts: string[] = [];
    const threadId = displayAuditValue(g.threadId);
    const redditUrl = displayAuditValue(g.redditUrl);
    const titleWithThread = threadId ? `${g.title} - <#${threadId}>` : g.title;
    parts.push(titleWithThread);
    if (redditUrl) {
      parts.push(`[Reddit](${redditUrl})`);
    }
    const firstLine = `- ${parts.join(' | ')}`;
    lines.push(firstLine);
  }
  return lines.join('\n');
}

function truncateField(value: string): string {
  const MAX = 1024; // Discord embed field value limit
  if (value.length <= MAX) return value;
  return value.slice(0, MAX - 3) + '...';
}

function buildResultsJumpLink(entry: GotmEntry, guildId?: string): string | undefined {
  if (!guildId || !ANNOUNCEMENTS_CHANNEL_ID) return undefined;
  const rawMsgId = (entry as any).votingResultsMessageId as string | undefined | null;
  const msgId = displayAuditValue(rawMsgId);
  if (!msgId) return undefined;
  return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${msgId}`;
}

function formatGamesWithJump(entry: GotmEntry, guildId?: string): string {
  const body = formatGames(entry.gameOfTheMonth, guildId);
  const link = buildResultsJumpLink(entry, guildId);
  if (!link) return truncateField(body);
  const tail = `[Voting Results](${link})`;
  return appendWithTailTruncate(body, tail);
}

function appendWithTailTruncate(body: string, tail: string): string {
  const MAX = 1024; // Align with existing truncateField limit
  const sep = body ? '\n\n' : '';
  const total = body.length + sep.length + tail.length;
  if (total <= MAX) return body + sep + tail;
  const availForBody = MAX - tail.length - sep.length;
  if (availForBody <= 0) return tail.slice(0, MAX);
  const trimmedBody = body.slice(0, Math.max(0, availForBody - 3)) + '...';
  return trimmedBody + sep + tail;
}
import { AUDIT_NO_VALUE_SENTINEL } from "./superadmin.command.js";
