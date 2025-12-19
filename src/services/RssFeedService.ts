import Parser from "rss-parser";
import crypto from "node:crypto";
import type { Client } from "discordx";
import {
  listFeeds,
  markItemsSeen,
  getSeenItemHashes,
  normalizeKeywords,
  type IRssFeedItem,
  type IRssFeed,
} from "../classes/RssFeed.js";

const POLL_INTERVAL_MS: number = 5 * 60 * 1000;
const parser = new Parser({
  timeout: 60_000,
});

function hashId(parts: (string | null | undefined)[]): string {
  const joined = parts.filter(Boolean).join("|");
  return crypto.createHash("sha256").update(joined).digest("hex");
}

function matchesKeywords(feed: IRssFeed, title: string, content: string): boolean {
  const haystack = `${title} ${content}`.toLowerCase();
  const include = normalizeKeywords(feed.includeKeywords);
  const exclude = normalizeKeywords(feed.excludeKeywords);

  if (exclude.length && exclude.some((kw) => haystack.includes(kw))) {
    return false;
  }
  if (include.length && !include.some((kw) => haystack.includes(kw))) {
    return false;
  }
  return true;
}

async function processFeed(client: Client, feed: IRssFeed): Promise<void> {
  let parsed;
  try {
    parsed = await parser.parseURL(feed.feedUrl);
  } catch (err) {
    console.error(`[RSS] Failed to parse feed ${feed.feedUrl}:`, err);
    return;
  }

  const newItems: IRssFeedItem[] = [];
  const candidates: { item: IRssFeedItem; link: string; title: string }[] = [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const item of parsed.items ?? []) {
    const title = item.title ?? "(no title)";
    const link = item.link ?? item.guid ?? "";
    const guid = item.guid ?? link ?? title;
    const content = item.contentSnippet ?? item.content ?? "";
    const hash = hashId([guid, link, title]);
    const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
    if (publishedAt && publishedAt.getTime() < cutoff) continue;
    if (!matchesKeywords(feed, title, content)) continue;

    const itemRecord: IRssFeedItem = {
      feedId: feed.feedId,
      itemIdHash: hash,
      itemGuid: item.guid ?? null,
      itemLink: item.link ?? null,
      publishedAt,
    };
    candidates.push({ item: itemRecord, link: link || "No link provided", title });
  }

  if (!candidates.length) return;

  const candidateHashes = candidates.map((c) => c.item.itemIdHash);
  const seen = await getSeenItemHashes(feed.feedId, candidateHashes);

  const toSend: { link: string; title: string }[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.item.itemIdHash)) continue;
    newItems.push(candidate.item);
    toSend.push({ link: candidate.link, title: candidate.title });
  }

  if (!newItems.length) return;

  await markItemsSeen(newItems);

  try {
    const channel = await client.channels.fetch(feed.channelId).catch(() => null);
    if (!channel) {
      console.warn(`[RSS] Channel ${feed.channelId} not found for feed #${feed.feedId}`);
      return;
    }
    if (!(typeof (channel as any).isTextBased === "function" && (channel as any).isTextBased())) {
      console.warn(`[RSS] Channel ${feed.channelId} is not text-based for feed #${feed.feedId}`);
      return;
    }

    if (toSend.length === 0) {
      return;
    }

    try {
      const textChannel: any = channel as any;
      for (const item of toSend) {
        await textChannel.send(`${item.title}\n${item.link}`);
      }
    } catch (err) {
      console.error(`[RSS] Failed to send items for feed ${feed.feedUrl}:`, err);
    }
  } catch (err) {
    console.error(`[RSS] Failed to fetch channel ${feed.channelId}:`, err);
  }
}

export function startRssFeedService(client: Client): void {
  const tick = async () => {
    try {
      const feeds = await listFeeds();
      for (const feed of feeds) {
        await processFeed(client, feed);
      }
    } catch (err) {
      console.error("[RSS] Polling error:", err);
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
}
