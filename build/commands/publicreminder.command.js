var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import { createReminder, deleteReminder, listUpcomingReminders, } from "../classes/PublicReminder.js";
import { DateTime } from "luxon";
const RECURRENCE_CHOICES = [
    { name: "Minutes", value: "minutes" },
    { name: "Hours", value: "hours" },
    { name: "Days", value: "days" },
    { name: "Weeks", value: "weeks" },
    { name: "Months", value: "months" },
    { name: "Years", value: "years" },
];
let PublicReminderCommand = class PublicReminderCommand {
    async create(channel, date, time, message, recurEvery, recurUnit, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        const dateTimeString = `${date} ${time}`;
        const formatsToTry = [
            "M/d/yyyy h:mm a",
            "M/d/yyyy HH:mm",
            "yyyy-M-d h:mm a",
            "yyyy-M-d HH:mm",
        ];
        let parsedDateTime = null;
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
                ephemeral: true,
            });
            return;
        }
        const parsedDate = parsedDateTime.toJSDate();
        if (parsedDate.getTime() <= Date.now()) {
            await safeReply(interaction, {
                content: "The reminder time must be in the future.",
                ephemeral: true,
            });
            return;
        }
        if (typeof recurEvery === "number" && recurEvery > 0 && !recurUnit) {
            await safeReply(interaction, {
                content: "Please specify recurunit when recur is provided.",
                ephemeral: true,
            });
            return;
        }
        if (recurEvery && recurEvery <= 0) {
            await safeReply(interaction, {
                content: "Recur must be a positive integer.",
                ephemeral: true,
            });
            return;
        }
        if (!message || message.trim().length === 0) {
            await safeReply(interaction, { content: "Message cannot be empty.", ephemeral: true });
            return;
        }
        try {
            const reminder = await createReminder(channel.id, message, parsedDate, recurEvery ?? null, recurUnit ?? null, interaction.user.id);
            const timestamp = Math.floor(parsedDate.getTime() / 1000);
            await safeReply(interaction, {
                content: `Created reminder #${reminder.reminderId} for <#${channel.id}> at <t:${timestamp}:F>.` +
                    `${recurEvery && recurUnit ? ` (repeats every ${recurEvery} ${recurUnit})` : ""}`,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to create reminder: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async list(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        try {
            const reminders = await listUpcomingReminders(20);
            if (!reminders.length) {
                await safeReply(interaction, { content: "No public reminders scheduled.", ephemeral: true });
                return;
            }
            const lines = reminders.map((r) => {
                const recur = r.recurEvery && r.recurUnit ? ` (repeats every ${r.recurEvery} ${r.recurUnit})` : "";
                const timestamp = Math.floor(r.dueAt.getTime() / 1000);
                return `#${r.reminderId}: <#${r.channelId}> at <t:${timestamp}:F>${recur} — ${r.message}`;
            });
            await safeReply(interaction, {
                content: lines.join("\n"),
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to list reminders: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async delete(reminderId, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        try {
            const removed = await deleteReminder(reminderId);
            await safeReply(interaction, {
                content: removed ? `Deleted reminder #${reminderId}.` : `Reminder #${reminderId} not found.`,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to delete reminder: ${msg}`,
                ephemeral: true,
            });
        }
    }
};
__decorate([
    Slash({ description: "Create a public reminder", name: "create" }),
    __param(0, SlashOption({
        description: "Channel to post the reminder",
        name: "channel",
        required: true,
        type: ApplicationCommandOptionType.Channel,
    })),
    __param(1, SlashOption({
        description: "Date of the reminder (e.g., 1/1/2026)",
        name: "date",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Time of the reminder (e.g., 9:00 AM or 15:30)",
        name: "time",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Reminder message",
        name: "message",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Repeat every N units (optional, positive integer)",
        name: "recur",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(5, SlashChoice(...RECURRENCE_CHOICES)),
    __param(5, SlashOption({
        description: "Recurrence unit (minutes, hours, days, weeks, months, years)",
        name: "recurunit",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], PublicReminderCommand.prototype, "create", null);
__decorate([
    Slash({ description: "List upcoming public reminders", name: "list" })
], PublicReminderCommand.prototype, "list", null);
__decorate([
    Slash({ description: "Delete a public reminder", name: "delete" }),
    __param(0, SlashOption({
        description: "Reminder id",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], PublicReminderCommand.prototype, "delete", null);
PublicReminderCommand = __decorate([
    Discord(),
    SlashGroup({ description: "Public reminders (admin-only)", name: "publicreminder" }),
    SlashGroup("publicreminder")
], PublicReminderCommand);
export { PublicReminderCommand };
