import { ActionRowBuilder, ButtonBuilder, ButtonStyle, } from "discord.js";
export const REMINDER_DONE_PREFIX = "remind-done-";
export const REMINDER_SNOOZE_PREFIX = "remind-snooze-";
export function formatReminderTime(date) {
    const seconds = Math.floor(date.getTime() / 1000);
    return `<t:${seconds}:f> (<t:${seconds}:R>)`;
}
export function buildReminderButtons(reminderId) {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(formatSnoozeId(60, reminderId))
        .setLabel("Snooze 1h")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(formatSnoozeId(1440, reminderId))
        .setLabel("Snooze 1d")
        .setStyle(ButtonStyle.Secondary), new ButtonBuilder()
        .setCustomId(formatDoneId(reminderId))
        .setLabel("Mark done")
        .setStyle(ButtonStyle.Success));
    return [row];
}
export function parseReminderButton(customId) {
    if (customId.startsWith(REMINDER_DONE_PREFIX)) {
        const idPart = customId.slice(REMINDER_DONE_PREFIX.length);
        const reminderId = Number(idPart);
        if (Number.isFinite(reminderId) && reminderId > 0) {
            return { kind: "done", reminderId };
        }
    }
    if (customId.startsWith(REMINDER_SNOOZE_PREFIX)) {
        const remaining = customId.slice(REMINDER_SNOOZE_PREFIX.length);
        const [minutesRaw, idRaw] = remaining.split("-");
        const minutes = Number(minutesRaw);
        const reminderId = Number(idRaw);
        if (Number.isFinite(minutes) && Number.isFinite(reminderId)) {
            return { kind: "snooze", minutes, reminderId };
        }
    }
    return null;
}
export function buildReminderMessage(reminder) {
    const time = formatReminderTime(reminder.remindAt);
    const extra = reminder.isNoisy
        ? "\n\n**This is a noisy reminder.** It will repeat every 15 minutes until you click 'Mark done' or delete it."
        : "";
    return (`You asked me to remind you: ${reminder.content}\n` +
        `Scheduled for ${time}.${extra}\n` +
        "Use the buttons below or /remindme commands to snooze or remove this reminder.");
}
function formatDoneId(reminderId) {
    return `${REMINDER_DONE_PREFIX}${reminderId}`;
}
function formatSnoozeId(minutes, reminderId) {
    return `${REMINDER_SNOOZE_PREFIX}${minutes}-${reminderId}`;
}
