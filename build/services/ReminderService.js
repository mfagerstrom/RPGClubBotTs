import Reminder from "../classes/Reminder.js";
import { buildReminderButtons, buildReminderMessage, } from "../functions/ReminderUi.js";
const CHECK_INTERVAL_MS = 60_000;
const MAX_REMINDERS_PER_CYCLE = 25;
let reminderTimer = null;
let currentlyChecking = false;
export function startReminderService(client) {
    if (reminderTimer) {
        return;
    }
    const run = async () => {
        if (currentlyChecking) {
            return;
        }
        currentlyChecking = true;
        try {
            await processDueReminders(client);
        }
        catch (err) {
            console.error("Reminder delivery failed:", err);
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
async function processDueReminders(client) {
    const now = new Date();
    const due = await Reminder.getDueUndelivered(now, MAX_REMINDERS_PER_CYCLE);
    for (const reminder of due) {
        await deliverReminder(client, reminder);
    }
}
async function deliverReminder(client, reminder) {
    try {
        const user = await client.users.fetch(reminder.userId);
        await user.send({
            content: buildReminderMessage(reminder),
            components: buildReminderButtons(reminder.reminderId),
        });
        if (reminder.isNoisy) {
            // If noisy, auto-snooze for 15 minutes instead of marking as done.
            const fifteenMinutesFromNow = new Date(Date.now() + 15 * 60 * 1000);
            await Reminder.snooze(reminder.reminderId, reminder.userId, fifteenMinutesFromNow);
        }
        else {
            await Reminder.markSent(reminder.reminderId);
        }
    }
    catch (err) {
        console.error(`Failed to deliver reminder ${reminder.reminderId}:`, err);
    }
}
