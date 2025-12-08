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
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import { createReminder, deleteReminder, listUpcomingReminders, } from "../classes/PublicReminder.js";
import { DateTime } from "luxon";
function parseUserDate(input) {
    const raw = (input ?? "").trim();
    if (!raw.length) {
        return null;
    }
    const relativeMatch = raw.match(/^in\s+(\d+)\s*(m|h|d|minutes?|hours?|days?)$/i);
    if (relativeMatch) {
        const amount = Number(relativeMatch[1]);
        const unitRaw = relativeMatch[2].toLowerCase();
        if (!Number.isFinite(amount) || amount <= 0) {
            return null;
        }
        const unit = unitRaw.startsWith("d")
            ? "days"
            : unitRaw.startsWith("h")
                ? "hours"
                : "minutes";
        const delta = {};
        delta[unit] = amount;
        const dt = DateTime.utc().plus(delta);
        if (dt.isValid) {
            return dt.toJSDate();
        }
    }
    const iso = DateTime.fromISO(raw, { setZone: true });
    if (iso.isValid) {
        return iso.toUTC().toJSDate();
    }
    const rfc = DateTime.fromRFC2822(raw, { zone: "utc" });
    if (rfc.isValid) {
        return rfc.toJSDate();
    }
    const fallback = DateTime.fromFormat(raw, "yyyy-LL-dd HH:mm", { zone: "utc" });
    if (fallback.isValid) {
        return fallback.toJSDate();
    }
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
        const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
        const dt = DateTime.fromMillis(millis, { zone: "utc" });
        if (dt.isValid) {
            return dt.toJSDate();
        }
    }
    return null;
}
const RECURRENCE_CHOICES = [
    { name: "Days", value: "days" },
    { name: "Weeks", value: "weeks" },
    { name: "Months", value: "months" },
    { name: "Years", value: "years" },
];
let PublicReminderCommand = class PublicReminderCommand {
    async create(channel, when, message, recurEvery, recurUnit, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        const parsedDate = parseUserDate(when);
        if (!parsedDate) {
            await safeReply(interaction, {
                content: "Could not parse the date/time. Use ISO, RFC2822, or 'in 30m', 'in 2h', etc.",
                ephemeral: true,
            });
            return;
        }
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
            await safeReply(interaction, {
                content: `Created reminder #${reminder.reminderId} for <#${channel.id}> at ` +
                    `${parsedDate.toLocaleString()}${recurEvery && recurUnit ? ` (repeats every ${recurEvery} ${recurUnit})` : ""}`,
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
                return `#${r.reminderId}: <#${r.channelId}> at ${r.dueAt.toLocaleString()}${recur} — ${r.message}`;
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
        description: "When to post (supports 'in 30m', ISO, or RFC2822)",
        name: "when",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Reminder message",
        name: "message",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Repeat every N units (optional, positive integer)",
        name: "recur",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(4, SlashOption({
        description: "Recurrence unit (days, weeks, months, years)",
        name: "recurunit",
        required: false,
        type: ApplicationCommandOptionType.String,
        choices: RECURRENCE_CHOICES.map((c) => ({ name: c.name, value: c.value })),
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
