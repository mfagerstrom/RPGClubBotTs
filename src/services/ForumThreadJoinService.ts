import type { ForumChannel, ThreadChannel } from "discord.js";
import { ChannelType } from "discord.js";
import type { Client } from "discordx";

const TARGET_FORUM_IDS: string[] = [
  "1059875931356938240", // Now Playing forum
  "1059887890991165490", // Live Event forum
];

function isForumChannel(channel: unknown): channel is ForumChannel {
  return Boolean(channel && (channel as any).type === ChannelType.GuildForum);
}

async function joinThread(thread: ThreadChannel): Promise<void> {
  try {
    if (!thread.joined) {
      await thread.join();
    }
  } catch (err) {
    const name = thread?.name ?? thread?.id ?? "unknown";
    console.error(`[ForumJoin] Failed to join thread ${name}:`, err);
  }
}

export async function joinAllTargetForumThreads(client: Client): Promise<void> {
  for (const forumId of TARGET_FORUM_IDS) {
    try {
      const channel = await client.channels.fetch(forumId);
      if (!isForumChannel(channel)) {
        continue;
      }

      const active = await channel.threads.fetchActive();
      for (const thread of active.threads.values()) {
        await joinThread(thread);
      }

      const archived = await channel.threads.fetchArchived();
      for (const thread of archived.threads.values()) {
        await joinThread(thread);
      }
    } catch (err) {
      console.error(`[ForumJoin] Failed to join threads for forum ${forumId}:`, err);
    }
  }
}

export async function joinThreadIfTarget(thread: ThreadChannel): Promise<void> {
  if (!thread?.parentId) return;
  if (!TARGET_FORUM_IDS.includes(thread.parentId)) return;
  await joinThread(thread);
}
