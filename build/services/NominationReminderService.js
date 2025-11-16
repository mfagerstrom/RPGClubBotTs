import { DateTime } from "luxon";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { NOMINATION_DISCUSSION_CHANNEL_IDS } from "../config/nominationChannels.js";
const CHECK_INTERVAL_MS = 60_000;
const REMINDER_ZONE = "America/New_York";
const REMINDERS = [
    {
        kind: "fiveDay",
        daysBefore: 5,
        wasSent: (entry) => entry.fiveDayReminderSent,
        description: "Voting is in five days",
    },
    {
        kind: "oneDay",
        daysBefore: 1,
        wasSent: (entry) => entry.oneDayReminderSent,
        description: "Voting is tomorrow",
    },
];
let reminderTimer = null;
let currentlyChecking = false;
function isSendableTextChannel(channel) {
    return Boolean(channel && typeof channel.send === "function");
}
export function startNominationReminderService(client) {
    if (reminderTimer) {
        return;
    }
    const run = async () => {
        if (currentlyChecking) {
            return;
        }
        currentlyChecking = true;
        try {
            await checkAndSendReminders(client);
        }
        catch (err) {
            console.error("Nomination reminder check failed:", err);
        }
        finally {
            currentlyChecking = false;
        }
    };
    void run();
    reminderTimer = setInterval(() => {
        void run();
    }, CHECK_INTERVAL_MS);
}
async function checkAndSendReminders(client) {
    const current = await BotVotingInfo.getCurrentRound();
    if (!current || !(current.nextVoteAt instanceof Date)) {
        return;
    }
    const entry = current;
    const voteTimeUtc = DateTime.fromJSDate(entry.nextVoteAt).toUTC();
    const nowUtc = DateTime.utc();
    for (const reminder of REMINDERS) {
        if (reminder.wasSent(entry)) {
            continue;
        }
        const reminderMomentUtc = voteTimeUtc
            .setZone(REMINDER_ZONE)
            .minus({ days: reminder.daysBefore })
            .set({ hour: 17, minute: 0, second: 0, millisecond: 0 })
            .toUTC();
        if (nowUtc < reminderMomentUtc) {
            continue;
        }
        const voteLabel = `${voteTimeUtc
            .setZone(REMINDER_ZONE)
            .toFormat("cccc, LLL dd")} (ET)`;
        const content = `${reminder.description}! (${voteLabel})\n` +
            "Please nominate games for the upcoming vote so they can be included.";
        const sent = await sendReminderToAllChannels(client, content);
        if (sent) {
            await BotVotingInfo.markReminderSent(entry.roundNumber, reminder.kind);
        }
    }
}
async function sendReminderToAllChannels(client, content) {
    let successCount = 0;
    for (const channelId of NOMINATION_DISCUSSION_CHANNEL_IDS) {
        try {
            const channel = await client.channels.fetch(channelId);
            if (!channel) {
                console.warn(`Nomination reminder skipped channel ${channelId}: not found.`);
                continue;
            }
            const textChannel = channel.isTextBased()
                ? channel
                : null;
            if (!textChannel || !isSendableTextChannel(textChannel)) {
                console.warn(`Nomination reminder skipped channel ${channelId}: not text-based or cannot send.`);
                continue;
            }
            await textChannel.send(content);
            successCount += 1;
        }
        catch (err) {
            console.error(`Failed to send nomination reminder to channel ${channelId}:`, err);
        }
    }
    return successCount > 0;
}
