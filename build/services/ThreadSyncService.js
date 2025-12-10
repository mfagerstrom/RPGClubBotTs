import { upsertThreadRecord } from "../classes/Thread.js";
const NOW_PLAYING_FORUM_ID = "1059875931356938240";
const DEFAULT_SYNC_INTERVAL_MS = 10 * 60 * 1000;
function isTargetForum(thread) {
    const parentId = thread?.parentId ?? null;
    return parentId === NOW_PLAYING_FORUM_ID;
}
async function captureThread(thread) {
    const createdAt = thread.createdAt ?? new Date();
    const lastSeenAt = thread.lastMessage?.createdAt ??
        (thread?.archiveTimestamp
            ? new Date(thread.archiveTimestamp)
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
async function syncForumThreads(client) {
    try {
        const forum = await client.channels.fetch(NOW_PLAYING_FORUM_ID);
        if (!forum || !("threads" in forum)) {
            console.warn("[ThreadSync] Forum channel not found or invalid");
            return;
        }
        const active = await forum.threads.fetchActive();
        const archived = await forum.threads.fetchArchived();
        for (const thread of active.threads.values()) {
            await captureThread(thread);
        }
        for (const thread of archived.threads.values()) {
            await captureThread(thread);
        }
    }
    catch (err) {
        console.error("[ThreadSync] Sync failed:", err);
    }
}
export function startThreadSyncService(client) {
    // Event hooks for freshness
    client.on("threadCreate", async (thread) => {
        try {
            if (!isTargetForum(thread))
                return;
            await captureThread(thread);
        }
        catch (err) {
            console.error("[ThreadSync] threadCreate handler failed:", err);
        }
    });
    client.on("messageCreate", async (message) => {
        try {
            const thread = message.channel;
            if (!("isThread" in thread) || !thread.isThread())
                return;
            if (!isTargetForum(thread))
                return;
            await upsertThreadRecord({
                threadId: thread.id,
                forumChannelId: NOW_PLAYING_FORUM_ID,
                threadName: thread.name ?? thread.id,
                isArchived: thread.archived ?? false,
                createdAt: thread.createdAt ?? new Date(),
                lastSeenAt: message.createdAt ?? new Date(),
            });
        }
        catch (err) {
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
