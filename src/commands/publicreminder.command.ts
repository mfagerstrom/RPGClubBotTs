import type { Channel, CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import {
  createReminder,
  deleteReminder,
  listUpcomingReminders,
  type RecurrenceUnit,
} from "../classes/PublicReminder.js";
import { DateTime } from "luxon";

const RECURRENCE_CHOICES: { name: string; value: RecurrenceUnit }[] = [
  { name: "Minutes", value: "minutes" },
  { name: "Hours", value: "hours" },
  { name: "Days", value: "days" },
  { name: "Weeks", value: "weeks" },
  { name: "Months", value: "months" },
  { name: "Years", value: "years" },
];

@Discord()
@SlashGroup({ description: "Public reminders (admin-only)", name: "publicreminder" })
@SlashGroup("publicreminder")
export class PublicReminderCommand {
  @Slash({ description: "Create a public reminder", name: "create" })
  async create(
    @SlashOption({
      description: "Channel to post the reminder",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel,
    @SlashOption({
      description: "Date of the reminder (e.g., 1/1/2026)",
      name: "date",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    date: string,
    @SlashOption({
      description: "Time of the reminder (e.g., 9:00 AM or 15:30)",
      name: "time",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    time: string,
    @SlashOption({
      description: "Reminder message",
      name: "message",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    message: string,
    @SlashOption({
      description: "Repeat every N units (optional, positive integer)",
      name: "recur",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    recurEvery: number | undefined,
    @SlashChoice(...RECURRENCE_CHOICES)
    @SlashOption({
      description: "Recurrence unit (minutes, hours, days, weeks, months, years)",
      name: "recurunit",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    recurUnit: RecurrenceUnit | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    const dateTimeString = `${date} ${time}`;
    const formatsToTry = [
      "M/d/yyyy h:mm a",
      "M/d/yyyy HH:mm",
      "yyyy-M-d h:mm a",
      "yyyy-M-d HH:mm",
    ];

    let parsedDateTime: DateTime | null = null;
    for (const format of formatsToTry) {
      const dt = DateTime.fromFormat(dateTimeString, format, { zone: "America/New_York" });
      if (dt.isValid) {
        parsedDateTime = dt;
        break;
      }
    }

    if (!parsedDateTime) {
      await safeReply(interaction, {
        content: `Could not parse the date and time: "${dateTimeString}". Please use formats like "1/1/2026" for date and "9:00 AM" or "15:30" for time.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const parsedDate = parsedDateTime.toJSDate();
    if (parsedDate.getTime() <= Date.now()) {
      await safeReply(interaction, {
        content: "The reminder time must be in the future.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (typeof recurEvery === "number" && recurEvery > 0 && !recurUnit) {
      await safeReply(interaction, {
        content: "Please specify recurunit when recur is provided.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (recurEvery && recurEvery <= 0) {
      await safeReply(interaction, {
        content: "Recur must be a positive integer.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!message || message.trim().length === 0) {
      await safeReply(interaction, { content: "Message cannot be empty.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const reminder = await createReminder(
        channel.id,
        message,
        parsedDate,
        recurEvery ?? null,
        recurUnit ?? null,
        interaction.user.id,
      );

      const timestamp = Math.floor(parsedDate.getTime() / 1000);
      await safeReply(interaction, {
        content:
          `Created reminder #${reminder.reminderId} for <#${channel.id}> at <t:${timestamp}:F>.` +
          `${recurEvery && recurUnit ? ` (repeats every ${recurEvery} ${recurUnit})` : ""}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create reminder: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "List upcoming public reminders", name: "list" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const reminders = await listUpcomingReminders(20);
      if (!reminders.length) {
        await safeReply(interaction, { content: "No public reminders scheduled.", flags: MessageFlags.Ephemeral });
        return;
      }

      const lines = reminders.map((r) => {
        const recur =
          r.recurEvery && r.recurUnit ? ` (repeats every ${r.recurEvery} ${r.recurUnit})` : "";
        const timestamp = Math.floor(r.dueAt.getTime() / 1000);
        return `#${r.reminderId}: <#${r.channelId}> at <t:${timestamp}:F>${recur} — ${r.message}`;
      });

      await safeReply(interaction, {
        content: lines.join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to list reminders: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Delete a public reminder", name: "delete" })
  async delete(
    @SlashOption({
      description: "Reminder id",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    reminderId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const removed = await deleteReminder(reminderId);
      await safeReply(interaction, {
        content: removed ? `Deleted reminder #${reminderId}.` : `Reminder #${reminderId} not found.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete reminder: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
