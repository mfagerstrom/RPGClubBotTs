import { AttachmentBuilder, EmbedBuilder, type Client } from "discord.js";
import type { GotmEntry, GotmGame } from "../classes/Gotm.js";
import type { NrGotmEntry, NrGotmGame } from "../classes/NrGotm.js";

const ANNOUNCEMENTS_CHANNEL_ID: string | undefined = process.env.ANNOUNCEMENTS_CHANNEL_ID;

const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";

export interface EmbedWithAttachments {
  embed: EmbedBuilder;
  files: AttachmentBuilder[];
}

type AnyGame = GotmGame | NrGotmGame;
type AnyEntry = GotmEntry | NrGotmEntry;

function displayAuditValue(value: string | null | undefined): string | null {
  if (value === AUDIT_NO_VALUE_SENTINEL) return null;
  return value ?? null;
}

function formatGames(games: AnyGame[]): string {
  if (!games || games.length === 0) return "(no games listed)";
  const lines: string[] = [];
  for (const g of games) {
    const threadId = displayAuditValue((g as any).threadId);
    const redditUrl = displayAuditValue((g as any).redditUrl);
    const parts: string[] = [];
    const titleWithThread = threadId ? `${g.title} - <#${threadId}>` : g.title;
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

function formatGamesWithJump(entry: AnyEntry, guildId?: string): string {
  const body = formatGames(entry.gameOfTheMonth as AnyGame[]);
  const link = buildResultsJumpLink(entry, guildId);
  if (!link) return truncateField(body);
  const tail = `[Voting Results](${link})`;
  return appendWithTailTruncate(body, tail);
}

function normalizeBuffer(value: unknown): Buffer | null {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  return null;
}

function guessImageExtension(mimeType: string | null | undefined): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  if (!mimeType) return "png";
  return map[mimeType.toLowerCase()] ?? "png";
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

function buildStoredImageAttachment(
  kind: "gotm" | "nr",
  entry: AnyEntry,
  game: AnyGame,
  gameIndex: number,
): AttachmentBuilder | null {
  const buf = normalizeBuffer((game as any).imageBlob ?? null);
  if (!buf) return null;
  const mime = (game as any).imageMimeType ?? "image/png";
  const ext = guessImageExtension(mime);
  const name = `${kind}-${(entry as any).round ?? "unknown"}-${gameIndex}.${ext}`;
  return new AttachmentBuilder(buf, {
    name,
    description: `${kind.toUpperCase()} image for round ${(entry as any).round ?? "?"}, game ${
      gameIndex + 1
    }`,
  });
}

async function resolveEntryImage(
  kind: "gotm" | "nr",
  entry: AnyEntry,
  games: AnyGame[],
  client: Client,
): Promise<{ thumbnailUrl: string | undefined; files: AttachmentBuilder[] }> {
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const stored = buildStoredImageAttachment(kind, entry, g, i);
    if (stored) {
      return { thumbnailUrl: `attachment://${stored.name}`, files: [stored] };
    }

    const threadId = displayAuditValue((g as any).threadId);
    if (!threadId) continue;
    const imgUrl = await resolveThreadImageUrl(client, threadId).catch(() => undefined);
    if (imgUrl) return { thumbnailUrl: imgUrl, files: [] };
  }

  return { thumbnailUrl: undefined, files: [] };
}

export async function buildGotmEntryEmbed(
  entry: GotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<EmbedWithAttachments> {
  const desc = formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const { thumbnailUrl, files } = await resolveEntryImage("gotm", entry, entry.gameOfTheMonth, client);
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return { embed, files };
}

export async function buildNrGotmEntryEmbed(
  entry: NrGotmEntry,
  guildId: string | undefined,
  client: Client,
): Promise<EmbedWithAttachments> {
  const desc = formatGamesWithJump(entry as AnyEntry, guildId);
  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`NR-GOTM Round ${entry.round} - ${entry.monthYear}`)
    .setDescription(desc);

  const jumpLink = buildResultsJumpLink(entry, guildId);
  if (jumpLink) embed.setURL(jumpLink);

  const winners = Array.isArray(entry.gameOfTheMonth)
    ? entry.gameOfTheMonth.filter((g) => !!g.threadId)
    : [];

  if (winners.length) {
    for (const w of winners) {
      const threadId = displayAuditValue((w as any).threadId);
      if (threadId) {
        embed.addFields({ name: "Winner", value: `<#${threadId}> — ${w.title}`, inline: false });
      }
    }
  }

  // Prefer stored images first; fall back to thread images
  const { thumbnailUrl, files } = await resolveEntryImage("nr", entry, entry.gameOfTheMonth, client);
  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  return { embed, files };
}
