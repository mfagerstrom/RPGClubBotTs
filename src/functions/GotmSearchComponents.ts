import { AttachmentBuilder, type Client } from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import Game from "../classes/Game.js";

const ANNOUNCEMENTS_CHANNEL_ID: string | undefined = process.env.ANNOUNCEMENTS_CHANNEL_ID;
const MAX_GAMES_PER_CONTAINER = 10;

type GotmLikeGame = {
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  gamedbGameId: number;
};

type GotmLikeEntry = {
  round: number;
  monthYear: string;
  gameOfTheMonth: GotmLikeGame[];
  votingResultsMessageId?: string | null;
};

export type GotmDisplayCard = {
  kindLabel: string;
  monthYear: string;
  round: number;
  title: string;
  threadId: string | null;
  redditUrl: string | null;
  gamedbGameId: number | null;
  votingResultsMessageId?: string | null;
};

export type GotmSearchMessagePayload = {
  components: ContainerBuilder[];
  files: AttachmentBuilder[];
};

type BuildGotmSearchMessagesOptions = {
  title: string;
  continuationTitle?: string;
  emptyMessage: string;
  queryLabel?: string;
  introText?: string;
  maxGamesPerContainer?: number;
  guildId?: string;
};

const threadImageCache = new Map<string, Promise<string | undefined>>();
const gameImageDataCache = new Map<number, Promise<Buffer | null>>();

export function buildGotmCardsFromEntries(
  entries: GotmLikeEntry[],
  kindLabel: string,
): GotmDisplayCard[] {
  const cards: GotmDisplayCard[] = [];
  for (const entry of entries) {
    for (const game of entry.gameOfTheMonth) {
      cards.push({
        kindLabel,
        monthYear: entry.monthYear,
        round: entry.round,
        title: game.title,
        threadId: game.threadId,
        redditUrl: game.redditUrl,
        gamedbGameId: Number.isInteger(game.gamedbGameId) ? game.gamedbGameId : null,
        votingResultsMessageId: entry.votingResultsMessageId ?? null,
      });
    }
  }
  return cards;
}

export async function buildGotmSearchMessages(
  client: Client,
  cards: GotmDisplayCard[],
  options: BuildGotmSearchMessagesOptions,
): Promise<GotmSearchMessagePayload[]> {
  const maxGamesPerContainer = Math.max(1, options.maxGamesPerContainer ?? MAX_GAMES_PER_CONTAINER);
  const chunks = chunkCards(cards, maxGamesPerContainer);

  if (!chunks.length) {
    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## ${options.title}`),
    );
    if (options.queryLabel) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Query: "${options.queryLabel}"`),
      );
    }
    if (options.introText) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(options.introText),
      );
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(options.emptyMessage),
    );
    return [{ components: [container], files: [] }];
  }

  const payloads: GotmSearchMessagePayload[] = [];
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    const container = new ContainerBuilder();
    const files: AttachmentBuilder[] = [];
    const title =
      chunkIndex === 0
        ? options.title
        : (options.continuationTitle ?? `${options.title} (continued)`);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
    if (chunkIndex === 0 && options.queryLabel) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Query: "${options.queryLabel}"`),
      );
    }
    if (chunkIndex === 0 && options.introText) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(options.introText),
      );
    }

    for (let itemIndex = 0; itemIndex < chunk.length; itemIndex += 1) {
      const card = chunk[itemIndex];
      const lines = [
        `### ${card.title}`,
        `-# ${card.kindLabel} | Round ${card.round} | ${card.monthYear}`,
      ];
      const detailsLine = buildDetailsLine(card, options.guildId);
      if (detailsLine) {
        lines.push(detailsLine);
      }
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );

      const accessory = await resolveAccessoryThumbnail(
        client,
        card,
        chunkIndex,
        itemIndex,
      );
      if (accessory.thumbnailUrl) {
        section.setThumbnailAccessory(new ThumbnailBuilder().setURL(accessory.thumbnailUrl));
      }
      if (accessory.file) {
        files.push(accessory.file);
      }

      container.addSectionComponents(section);
    }

    payloads.push({ components: [container], files });
  }

  return payloads;
}

function buildDetailsLine(card: GotmDisplayCard, guildId?: string): string | null {
  const parts: string[] = [];
  if (card.threadId) {
    parts.push(`<#${card.threadId}>`);
  }
  if (card.redditUrl) {
    parts.push(`[Reddit](${card.redditUrl})`);
  }
  const votingResultsLink = buildVotingResultsLink(card, guildId);
  if (votingResultsLink) {
    parts.push(`[Voting Results](${votingResultsLink})`);
  }
  return parts.length ? parts.join(" | ") : null;
}

function buildVotingResultsLink(card: GotmDisplayCard, guildId?: string): string | null {
  if (!guildId || !ANNOUNCEMENTS_CHANNEL_ID || !card.votingResultsMessageId) {
    return null;
  }
  return `https://discord.com/channels/${guildId}/${ANNOUNCEMENTS_CHANNEL_ID}/${card.votingResultsMessageId}`;
}

function chunkCards(cards: GotmDisplayCard[], size: number): GotmDisplayCard[][] {
  const out: GotmDisplayCard[][] = [];
  for (let i = 0; i < cards.length; i += size) {
    out.push(cards.slice(i, i + size));
  }
  return out;
}

async function resolveAccessoryThumbnail(
  client: Client,
  card: GotmDisplayCard,
  chunkIndex: number,
  itemIndex: number,
): Promise<{ thumbnailUrl: string | undefined; file?: AttachmentBuilder }> {
  if (card.threadId) {
    const threadImage = await getThreadStarterImage(client, card.threadId).catch(() => undefined);
    if (threadImage) {
      return { thumbnailUrl: threadImage };
    }
  }

  if (!card.gamedbGameId) {
    return { thumbnailUrl: undefined };
  }

  const imageData = await getGameImageData(card.gamedbGameId);
  if (!imageData) {
    return { thumbnailUrl: undefined };
  }

  const fileName = `gotm-thumb-${chunkIndex}-${itemIndex}-${card.gamedbGameId}.png`;
  const file = new AttachmentBuilder(imageData, { name: fileName });
  return {
    file,
    thumbnailUrl: `attachment://${fileName}`,
  };
}

async function getGameImageData(gameId: number): Promise<Buffer | null> {
  if (!gameImageDataCache.has(gameId)) {
    gameImageDataCache.set(
      gameId,
      (async () => {
        const game = await Game.getGameById(gameId).catch(() => null);
        return game?.imageData ?? null;
      })(),
    );
  }
  return gameImageDataCache.get(gameId) ?? Promise.resolve(null);
}

async function getThreadStarterImage(
  client: Client,
  threadId: string,
): Promise<string | undefined> {
  if (!threadImageCache.has(threadId)) {
    threadImageCache.set(threadId, resolveThreadStarterImage(client, threadId));
  }
  return threadImageCache.get(threadId);
}

async function resolveThreadStarterImage(
  client: Client,
  threadId: string,
): Promise<string | undefined> {
  const channel = await client.channels.fetch(threadId).catch(() => null);
  const anyThread = channel as any;
  if (!anyThread || typeof anyThread.fetchStarterMessage !== "function") {
    return undefined;
  }
  const starter = await anyThread.fetchStarterMessage().catch(() => null);
  if (!starter) return undefined;

  for (const att of starter.attachments?.values?.() ?? []) {
    const anyAtt = att as any;
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
    const anyEmb = emb as any;
    const imageUrl: string | undefined =
      emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
    const thumbUrl: string | undefined =
      emb.thumbnail?.url || anyEmb?.thumbnail?.proxyURL || anyEmb?.thumbnail?.proxy_url;
    if (imageUrl) return imageUrl;
    if (thumbUrl) return thumbUrl;
  }
  return undefined;
}
