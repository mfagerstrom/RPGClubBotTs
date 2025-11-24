import type { User } from "discord.js";
import type { Client } from "discordx";
import Reminder, { type IReminderRecord } from "../classes/Reminder.js";
import {
  buildReminderButtons,
  buildReminderMessage,
} from "../functions/ReminderUi.js";

const CHECK_INTERVAL_MS = 60_000;
const MAX_REMINDERS_PER_CYCLE = 25;

let reminderTimer: NodeJS.Timeout | null = null;
let currentlyChecking = false;

export function startReminderService(client: Client): void {
  if (reminderTimer) {
    return;
  }

  const run = async (): Promise<void> => {
    if (currentlyChecking) {
      return;
    }

    currentlyChecking = true;
    try {
      await processDueReminders(client);
    } catch (err) {
      console.error("Reminder delivery failed:", err);
    } finally {
      currentlyChecking = false;
    }
  };

  void run();
  reminderTimer = setInterval(() => {
    void run();
  }, CHECK_INTERVAL_MS);
}

async function processDueReminders(client: Client): Promise<void> {
  const now = new Date();
  const due = await Reminder.getDueUndelivered(now, MAX_REMINDERS_PER_CYCLE);

  for (const reminder of due) {
    await deliverReminder(client, reminder);
  }
}

async function deliverReminder(
  client: Client,
  reminder: IReminderRecord,
): Promise<void> {
  try {
    const user: User = await client.users.fetch(reminder.userId);
    await user.send({
      content: buildReminderMessage(reminder),
      components: buildReminderButtons(reminder.reminderId),
    });

    await Reminder.markSent(reminder.reminderId);
  } catch (err) {
    console.error(`Failed to deliver reminder ${reminder.reminderId}:`, err);
  }
}
