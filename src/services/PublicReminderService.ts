import type { Client } from "discordx";
import {
  listUpcomingReminders,
  updateReminderDueDate,
  disableReminder,
  type IPublicReminder,
} from "../classes/PublicReminder.js";

const PUBLIC_REMINDER_INTERVAL_MS: number = 60_000;
const MAX_PER_CYCLE = 50;

let publicReminderTimer: NodeJS.Timeout | null = null;
let checkingPublic = false;

export function startPublicReminderService(client: Client): void {
  if (publicReminderTimer) return;

  const run = async (): Promise<void> => {
    if (checkingPublic) return;
    checkingPublic = true;
    try {
      await checkPublicReminders(client);
    } catch (err) {
      console.error("[PublicReminderService] Error checking reminders:", err);
    } finally {
      checkingPublic = false;
    }
  };

  void run();
  publicReminderTimer = setInterval(() => {
    void run();
  }, PUBLIC_REMINDER_INTERVAL_MS);
}

async function checkPublicReminders(client: Client): Promise<void> {
  const now = Date.now();
  const reminders = await listUpcomingReminders(MAX_PER_CYCLE);
  for (const reminder of reminders) {
    if (!reminder.enabled) continue;
    const due = reminder.dueAt.getTime();
    if (due > now) continue;

    try {
      const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
      if (!channel || !(channel as any).isTextBased?.()) continue;
      await (channel as any).send(reminder.message);
    } catch (err) {
      console.error(`[PublicReminderService] Failed to send reminder #${reminder.reminderId}:`, err);
    }

    await handleRecurrence(reminder);
  }
}

async function handleRecurrence(reminder: IPublicReminder): Promise<void> {
  if (reminder.recurEvery && reminder.recurUnit) {
    const nextDue = computeNextDue(reminder);
    if (nextDue) {
      await updateReminderDueDate(reminder.reminderId, nextDue);
      return;
    }
  }
  await disableReminder(reminder.reminderId);
}

function computeNextDue(reminder: IPublicReminder): Date | null {
  if (!reminder.recurEvery || !reminder.recurUnit) return null;
  const current = reminder.dueAt;
  const n = reminder.recurEvery;
  const next = new Date(current);
  if (reminder.recurUnit === "minutes") {
    next.setMinutes(next.getMinutes() + n);
  } else if (reminder.recurUnit === "hours") {
    next.setHours(next.getHours() + n);
  } else if (reminder.recurUnit === "days") {
    next.setDate(next.getDate() + n);
  } else if (reminder.recurUnit === "weeks") {
    next.setDate(next.getDate() + n * 7);
  } else if (reminder.recurUnit === "months") {
    next.setMonth(next.getMonth() + n);
  } else if (reminder.recurUnit === "years") {
    next.setFullYear(next.getFullYear() + n);
  } else {
    return null;
  }
  return next;
}
