import type { TextBasedChannel } from "discord.js";
import type { Client } from "discordx";
import { DateTime } from "luxon";
import GameReleaseAnnouncement, {
  type IReleaseAnnouncementCandidate,
} from "../classes/GameReleaseAnnouncement.js";
import { GAME_NEWS_CHANNEL_ID } from "../config/channels.js";
import { GameDb } from "../commands/gamedb.command.js";
import { COMPONENTS_V2_FLAG } from "../config/flags.js";

const CHECK_INTERVAL_MS = 60_000;
const BATCH_SIZE = 25;
const RELEASE_SCHEDULING_ZONE = "UTC";
const gameDbCommand = new GameDb();

let gameReleaseTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

type SendableTextChannel = TextBasedChannel & {
  send: (options: any) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function buildAnnouncementPreface(candidate: IReleaseAnnouncementCandidate): string {
  const releaseTime = DateTime.fromJSDate(candidate.releaseDate).setZone(RELEASE_SCHEDULING_ZONE);
  const releaseUnix = Math.floor(releaseTime.toSeconds());

  const lines: string[] = [
    "🎮 **Upcoming release!**",
    `Release: <t:${releaseUnix}:F> (<t:${releaseUnix}:R>)`,
  ];

  if (candidate.igdbUrl) {
    lines.push(`Source: ${candidate.igdbUrl}`);
  }

  return lines.join("\n");
}

async function fetchGameNewsChannel(client: Client): Promise<SendableTextChannel | null> {
  const channel = await client.channels.fetch(GAME_NEWS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return null;
  }
  return isSendableTextChannel(channel) ? channel : null;
}

function getGuildId(channel: SendableTextChannel): string | undefined {
  if ("guildId" in channel && typeof channel.guildId === "string") {
    return channel.guildId;
  }
  return undefined;
}

async function checkAndSendReleaseAnnouncements(client: Client): Promise<void> {
  const now = DateTime.utc().toJSDate();
  await GameReleaseAnnouncement.syncReleaseAnnouncements();
  await GameReleaseAnnouncement.markNonCanonicalAnnouncements();
  await GameReleaseAnnouncement.markMissedAnnouncements(now);

  const due = await GameReleaseAnnouncement.listDueAnnouncements(now, BATCH_SIZE);
  if (!due.length) {
    return;
  }

  const channel = await fetchGameNewsChannel(client);
  if (!channel) {
    console.warn(
      `[GameReleaseAnnouncementService] Game news channel ${GAME_NEWS_CHANNEL_ID} is unavailable.`,
    );
    return;
  }

  for (const candidate of due) {
    try {
      const payload = await gameDbCommand.buildGameProfileMessagePayload(candidate.gameId, {
        includeActions: true,
        guildId: getGuildId(channel),
        prefaceText: buildAnnouncementPreface(candidate),
      });
      if (!payload) {
        console.warn(
          `[GameReleaseAnnouncementService] Missing GameDB profile for release ${candidate.releaseId}.`,
        );
        continue;
      }
      await channel.send({
        files: payload.files,
        components: payload.components,
        flags: COMPONENTS_V2_FLAG,
      });
      await GameReleaseAnnouncement.markAnnouncementSent(candidate.releaseId, new Date());
    } catch (err) {
      console.error(
        `[GameReleaseAnnouncementService] Failed release announcement ${candidate.releaseId}:`,
        err,
      );
    }
  }
}

export function startGameReleaseAnnouncementService(client: Client): void {
  if (gameReleaseTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyChecking) {
      return;
    }
    currentlyChecking = true;
    try {
      await checkAndSendReleaseAnnouncements(client);
    } catch (err) {
      console.error("[GameReleaseAnnouncementService] Announcement cycle failed:", err);
    } finally {
      currentlyChecking = false;
    }
  };

  void run();
  gameReleaseTimer = setInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}
