import { EmbedBuilder, type Client } from "discord.js";
import type { GotmEntry, GotmGame } from "../classes/Gotm.js";
import type { NrGotmEntry, NrGotmGame } from "../classes/NrGotm.js";

const ANNOUNCEMENTS_CHANNEL_ID: string | undefined = process.env.ANNOUNCEMENTS_CHANNEL_ID;

type AnyGame = GotmGame | NrGotmGame;
type AnyEntry = GotmEntry | NrGotmEntry;

function formatGames(games: AnyGame[]): string {
  if (!games || games.length === 0) return "(no games listed)";
  const lines: string[] = [];
  for (const g of games) {
    const parts: string[] = [];
    const titleWithThread = g.threadId ? `${g.title} - <#${g.threadId}>` : g.title;
    parts.push(titleWithThread);
    if (g.redditUrl) {
      parts.push(`[Reddit](${g.redditUrl})`);
    }
    const firstLine = `- ${parts.join(" | ")}`;
    lines.push(firstLine);
  }
  return lines.join("\n");
}

function truncateField(value: string): string {
  const MAX = 1024;
  if (value.length <= MAX) return value;
  return value.slice(0, MAX - 3) + "...";
}

function appendWithTailTruncate(body: string, tail: string): string {
  const MAX = 1024;
  const sep = body ? "\n\n" : "";
  const total = body.length + sep.length + tail.length;
  if (total <= MAX) return body + sep + tail;
  const availForBody = MAX - tail.length - sep.length;
  if (availForBody <= 0) return tail.slice(0, MAX);
  const trimmedBody = body.slice(0, Math.max(0, availForBody - 3)) + "...";
  return trimmedBody + sep + tail;
}

function buildResultsJumpLink(entry: AnyEntry, guildId?: string): string | undefined {
  if (!guildId || !ANNOUNCEMENTS_CHANNEL_ID) return undefined;
  const msgId = (entry as any).votingResultsMessageId as string | undefined | null;
  if (!msgId) return undefined;
  return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${msgId}`;
}

function formatGamesWithJump(entry: AnyEntry, guildId?: string): string {
  const body = formatGames(entry.gameOfTheMonth as AnyGame[]);
  const link = buildResultsJumpLink(entry, guildId);
  if (!link) return truncateField(body);
  const tail = `[Voting Results](${link})`;
  return appendWithTailTruncate(body, tail);
}

async function resolveThreadImageUrl(
  client: Client,
  threadId: string,
): Promise<string | undefined> {
  try {
    const channel = await client.channels.fetch(threadId);
    const anyThread = channel as any;
    if (!anyThread || typeof anyThread.fetchStarterMessage !== "function") {
      return undefined;
    }
    const starter = await anyThread.fetchStarterMessage().catch(() => null);
    if (!starter) return undefined;

    for (const att of starter.attachments?.values?.() ?? []) {
      const anyAtt: any = att as any;
      const nameLc = (anyAtt.name ?? "").toLowerCase();
      const ctype = (anyAtt.contentType ?? "").toLowerCase();
      if (
        ctype.startsWith("image/") ||
        /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) ||
        anyAtt.width
      ) {
        return anyAtt.url ?? anyAtt.proxyURL;
      }
    }

    for (const emb of starter.embeds ?? []) {
      const anyEmb: any = emb as any;
      const imgUrl: string | undefined =
        emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
      const thumbUrl: string | undefined =
        emb.thumbnail?.url ||
        anyEmb?.thumbnail?.proxyURL ||
        anyEmb?.thumbnail?.proxy_url;
      if (imgUrl) return imgUrl;
      if (thumbUrl) return thumbUrl;
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function findFirstGameImage(
  client: Client,
  games: AnyGame[],
): Promise<string | undefined> {
  for (const g of games) {
    if (!g.threadId) continue;
    const imgUrl = await resolveThreadImageUrl(client, g.threadId).catch(() => undefined);
    if (imgUrl) return imgUrl;
  }
  return undefined;
}

export async function buildGotmEntryEmbed(
  entry: GotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<EmbedBuilder> {
  const desc = formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const imgUrl = await findFirstGameImage(client, entry.gameOfTheMonth);
  if (imgUrl) {
    embed.setThumbnail(imgUrl);
  }

  return embed;
}

export async function buildNrGotmEntryEmbed(
  entry: NrGotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<EmbedBuilder> {
  const desc = formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const imgUrl = await findFirstGameImage(client, entry.gameOfTheMonth);
  if (imgUrl) {
    embed.setThumbnail(imgUrl);
  }

  return embed;
}

