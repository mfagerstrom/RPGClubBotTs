import { EmbedBuilder } from "discord.js";
import type { Client, TextBasedChannel } from "discord.js";
import axios from "axios";
import Game from "../classes/Game.js";
import { igdbService } from "./IgdbService.js";

type AutoAcceptResult = {
  updated: number;
  skipped: number;
  failed: number;
  logs: string[];
};

const MAX_LOG_CHARS = 3500;

async function performAutoAcceptImages(
  onProgress?: (line: string) => Promise<void>,
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(true, false, false);
  const candidates = games.filter((game) => !game.imageData && game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const game of candidates) {
    try {
      if (!game.igdbId) {
        skipped++;
        continue;
      }

      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details || !details.cover?.image_id) {
        skipped++;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB cover found)`);
        continue;
      }

      const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const buffer = Buffer.from(resp.data);

      await Game.updateGameImage(game.id, buffer);
      updated++;
      await addLog(`✅ Updated **${game.title}**`);
    } catch (err: any) {
      failed++;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

async function performAutoAcceptVideos(
  onProgress?: (line: string) => Promise<void>,
): Promise<AutoAcceptResult> {
  const games = await Game.getGamesForAudit(false, false, true);
  const candidates = games.filter((game) => !game.featuredVideoUrl && game.igdbId);

  if (!candidates.length) {
    return { updated: 0, skipped: 0, failed: 0, logs: [] };
  }

  const logs: string[] = [];
  const addLog = async (line: string): Promise<void> => {
    logs.push(line);
    if (onProgress) {
      await onProgress(line);
    }
  };

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const game of candidates) {
    try {
      if (!game.igdbId) {
        skipped++;
        continue;
      }

      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details) {
        skipped++;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB details)`);
        continue;
      }

      const videoUrl = Game.getFeaturedVideoUrl(details);
      if (!videoUrl) {
        skipped++;
        await addLog(`⏭️ Skipped **${game.title}** (No IGDB video found)`);
        continue;
      }

      await Game.updateFeaturedVideoUrl(game.id, videoUrl);
      updated++;
      await addLog(`✅ Updated **${game.title}**`);
    } catch (err: any) {
      failed++;
      await addLog(`❌ Failed **${game.title}**: ${err?.message ?? String(err)}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { updated, skipped, failed, logs };
}

function trimLogLines(lines: string[]): string[] {
  const copy = [...lines];
  let content = copy.join("\n");
  while (content.length > MAX_LOG_CHARS) {
    copy.shift();
    content = copy.join("\n");
  }
  return copy;
}

async function resolveTextChannel(
  client: Client,
  channelId: string,
): Promise<TextBasedChannel | null> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }
  return channel as TextBasedChannel;
}

export async function runAutoAcceptImagesAudit(
  client: Client,
  channelId: string,
): Promise<void> {
  const channel = await resolveTextChannel(client, channelId);
  if (!channel || typeof (channel as any).send !== "function") {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("GameDB Auto Accept Images")
    .setDescription("Starting auto accept run...")
    .setColor(0x0099ff);

  const message = await (channel as any).send({ embeds: [embed] });
  const logLines: string[] = [];

  const updateEmbed = async (line?: string): Promise<void> => {
    if (line) {
      logLines.push(line);
    }
    const trimmed = trimLogLines(logLines);
    const content = trimmed.length ? trimmed.join("\n") : "Processing...";
    embed.setDescription(content);
    await message.edit({ embeds: [embed] }).catch(() => {});
  };

  const { updated, skipped, failed, logs } = await performAutoAcceptImages(updateEmbed);
  if (!logs.length) {
    embed
      .setDescription("No games found with missing images and valid IGDB IDs.")
      .setColor(0x2ecc71);
    await message.edit({ embeds: [embed] }).catch(() => {});
    return;
  }

  const summary =
    `\n**Run Complete**\n✅ Updated: ${updated}\n` +
    `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
  await updateEmbed(summary);
  embed.setColor(0x2ecc71);
  await message.edit({ embeds: [embed] }).catch(() => {});
}

export function startGamedbAutoImageAuditService(
  client: Client,
  channelId: string,
  intervalMs: number,
): void {
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runAutoAcceptImagesAudit(client, channelId);
    } catch (err) {
      console.error("GameDB auto accept image audit failed:", err);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => {
    void run();
  }, intervalMs);
}

export { performAutoAcceptImages, performAutoAcceptVideos };
