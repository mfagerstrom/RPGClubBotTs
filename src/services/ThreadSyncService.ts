import type {
  AnyThreadChannel,
  Client,
  Message,
  ThreadChannel,
} from "discord.js";
import { upsertThreadRecord } from "../classes/Thread.js";

const NOW_PLAYING_FORUM_ID = "1059875931356938240";
const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000;

function isTargetForum(thread: AnyThreadChannel | ThreadChannel | null): boolean {
  const parentId = (thread as any)?.parentId ?? null;
  return parentId === NOW_PLAYING_FORUM_ID;
}

async function captureThread(thread: AnyThreadChannel | ThreadChannel): Promise<void> {
  const createdAt: Date = thread.createdAt ?? new Date();
  const lastSeenAt: Date | null =
    thread.lastMessage?.createdAt ??
    ((thread as any)?.archiveTimestamp
      ? new Date((thread as any).archiveTimestamp)
      : null);

  await upsertThreadRecord({
    threadId: thread.id,
    forumChannelId: NOW_PLAYING_FORUM_ID,
    threadName: thread.name ?? thread.id,
    isArchived: thread.archived ?? false,
    createdAt,
    lastSeenAt,
  });
}

async function syncForumThreads(client: Client): Promise<void> {
  try {
    const forum = await client.channels.fetch(NOW_PLAYING_FORUM_ID);
    if (!forum || !("threads" in forum)) {
      console.warn("[ThreadSync] Forum channel not found or invalid");
      return;
    }

    const active = await (forum as any).threads.fetchActive();
    const archived = await (forum as any).threads.fetchArchived();

    for (const thread of active.threads.values()) {
      await captureThread(thread);
    }
    for (const thread of archived.threads.values()) {
      await captureThread(thread);
    }
  } catch (err) {
    console.error("[ThreadSync] Sync failed:", err);
  }
}

export function startThreadSyncService(client: Client): void {
  // Event hooks for freshness
  client.on("threadCreate", async (thread) => {
    try {
      if (!isTargetForum(thread)) return;
      await captureThread(thread);
    } catch (err) {
      console.error("[ThreadSync] threadCreate handler failed:", err);
    }
  });

  client.on("messageCreate", async (message: Message) => {
    try {
      const thread = message.channel;
      if (!("isThread" in thread) || !thread.isThread()) return;
      if (!isTargetForum(thread)) return;

      await upsertThreadRecord({
        threadId: thread.id,
        forumChannelId: NOW_PLAYING_FORUM_ID,
        threadName: thread.name ?? thread.id,
        isArchived: thread.archived ?? false,
        createdAt: thread.createdAt ?? new Date(),
        lastSeenAt: message.createdAt ?? new Date(),
      });
    } catch (err) {
      console.error("[ThreadSync] messageCreate handler failed:", err);
    }
  });

  // Periodic poller
  void syncForumThreads(client);
  setInterval(() => {
    void syncForumThreads(client);
  }, DEFAULT_SYNC_INTERVAL_MS);

  console.log("[ThreadSync] Service started");
}
