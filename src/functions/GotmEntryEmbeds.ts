import { AttachmentBuilder, EmbedBuilder, type Client } from "discord.js";
import type { IGotmEntry, IGotmGame } from "../classes/Gotm.js";
import type { INrGotmEntry, INrGotmGame } from "../classes/NrGotm.js";
import Game from "../classes/Game.js";

const ANNOUNCEMENTS_CHANNEL_ID: string | undefined = process.env.ANNOUNCEMENTS_CHANNEL_ID;

const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";

export interface IEmbedWithAttachments {
  embed: EmbedBuilder;
  files: AttachmentBuilder[];
}

type AnyGame = IGotmGame | INrGotmGame;
type AnyEntry = IGotmEntry | INrGotmEntry;

const gameCache: Map<number, Awaited<ReturnType<typeof Game.getGameById>>> = new Map();

async function getGameMeta(id: number): Promise<Awaited<ReturnType<typeof Game.getGameById>>> {
  if (gameCache.has(id)) {
    return gameCache.get(id)!;
  }
  const game = await Game.getGameById(id);
  if (!game) {
    throw new Error(`GameDB id ${id} not found`);
  }
  gameCache.set(id, game);
  return game;
}

function displayAuditValue(value: string | null | undefined): string | null {
  if (value === AUDIT_NO_VALUE_SENTINEL) return null;
  return value ?? null;
}

async function formatGames(games: AnyGame[]): Promise<string> {
  if (!games || games.length === 0) return "(no games listed)";
  const lines: string[] = [];
  for (const g of games) {
    const threadId = displayAuditValue((g as any).threadId);
    const redditUrl = displayAuditValue((g as any).redditUrl);
    const parts: string[] = [];
    const title = g.gamedbGameId ? (await getGameMeta(g.gamedbGameId))?.title ?? g.title : g.title;
    const titleWithThread = threadId ? `${title} - <#${threadId}>` : title;
    parts.push(titleWithThread);
    if (redditUrl) {
      parts.push(`[Reddit](${redditUrl})`);
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
  const rawMsgId = (entry as any).votingResultsMessageId as string | undefined | null;
  const msgId = displayAuditValue(rawMsgId);
  if (!msgId) return undefined;
  return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${msgId}`;
}

async function formatGamesWithJump(entry: AnyEntry, guildId?: string): Promise<string> {
  const body = await formatGames(entry.gameOfTheMonth as AnyGame[]);
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

async function resolveEntryImage(
  entry: AnyEntry,
  games: AnyGame[],
  client: Client,
): Promise<{ thumbnailUrl: string | undefined; files: AttachmentBuilder[] }> {
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const threadId = displayAuditValue((g as any).threadId);
    if (!threadId) continue;
    const imgUrl = await resolveThreadImageUrl(client, threadId).catch(() => undefined);
    if (imgUrl) return { thumbnailUrl: imgUrl, files: [] };
  }

  // No thread images; try GameDB cover
  for (const g of games) {
    if (!g.gamedbGameId) continue;
    const meta = await getGameMeta(g.gamedbGameId).catch(() => null);
    if (meta?.imageData) {
      const buf = meta.imageData;
      const name = `gamedb-${g.gamedbGameId}.png`;
      const file = new AttachmentBuilder(buf, { name });
      return { thumbnailUrl: `attachment://${name}`, files: [file] };
    }
  }

  return { thumbnailUrl: undefined, files: [] };
}

export async function buildGotmEntryEmbed(
  entry: IGotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<IEmbedWithAttachments> {
  const desc = await formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const { thumbnailUrl, files } = await resolveEntryImage(entry, entry.gameOfTheMonth, client);
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return { embed, files };
}

export async function buildNrGotmEntryEmbed(
  entry: INrGotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<IEmbedWithAttachments> {
  const desc = await formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const { thumbnailUrl, files } = await resolveEntryImage(entry, entry.gameOfTheMonth, client);
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return { embed, files };
}
