import { ChannelType } from "discord.js";
const TARGET_FORUM_IDS = [
    "1059875931356938240", // Now Playing forum
    "1059887890991165490", // Live Event forum
];
function isForumChannel(channel) {
    return Boolean(channel && channel.type === ChannelType.GuildForum);
}
async function joinThread(thread) {
    try {
        if (!thread.joined) {
            await thread.join();
        }
    }
    catch (err) {
        const name = thread?.name ?? thread?.id ?? "unknown";
        console.error(`[ForumJoin] Failed to join thread ${name}:`, err);
    }
}
export async function joinAllTargetForumThreads(client) {
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
        }
        catch (err) {
            console.error(`[ForumJoin] Failed to join threads for forum ${forumId}:`, err);
        }
    }
}
export async function joinThreadIfTarget(thread) {
    if (!thread?.parentId)
        return;
    if (!TARGET_FORUM_IDS.includes(thread.parentId))
        return;
    await joinThread(thread);
}
