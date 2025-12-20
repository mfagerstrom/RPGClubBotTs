import {
  ApplicationCommandOptionType,
  ButtonInteraction,
  CommandInteraction,
  MessageFlags,
} from "discord.js";
import { DateTime } from "luxon";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import Reminder, { type IReminderRecord } from "../classes/Reminder.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import {
  buildReminderButtons,
  formatReminderTime,
  parseReminderButton,
} from "../functions/ReminderUi.js";

@Discord()
@SlashGroup({ description: "Set personal reminders", name: "remindme" })
@SlashGroup("remindme")
export class RemindMeCommand {
  @Slash({ description: "Create a reminder", name: "create" })
  async create(
    @SlashOption({
      description: "When should I remind you? (e.g., 2024-12-01 09:00 ET, in 2h, in 15m)",
      name: "when",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    when: string,
    @SlashOption({
      description: "What should I remind you about?",
      name: "note",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    note: string | undefined,
    @SlashOption({
      description: "Repeat every 15m until done? (default: false)",
      name: "noisy",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    noisy: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const parsedDate = parseUserDate(when);
    if (!parsedDate) {
      await safeReply(interaction, {
        content: formatDateHelpText("Sorry, I could not understand that time."),
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const now = DateTime.utc();
    const remindAt = DateTime.fromJSDate(parsedDate).toUTC();
    if (remindAt <= now.plus({ minutes: 1 })) {
      await safeReply(interaction, {
        content: "Reminders must be at least one minute in the future.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const isNoisy = !!noisy;
    const reminder = await Reminder.create(
      interaction.user.id,
      remindAt.toJSDate(),
      note ?? "Reminder",
      isNoisy,
    );

    const noisyText = isNoisy ? " (noisy)" : "";
    await safeReply(interaction, {
      content:
        `Saved reminder #${reminder.reminderId} for ${formatReminderTime(
          remindAt.toJSDate(),
        )}.${noisyText}\n` + "I will DM you at that time with snooze options.",
      ephemeral,
      components: buildReminderButtons(reminder.reminderId),
    });
  }

  @Slash({ description: "Show your reminders and usage help", name: "menu" })
  async menu(
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const reminders = await Reminder.listByUser(interaction.user.id);
    const header = "**Your reminders**";
    const body = reminders.length
      ? reminders.map(formatReminderLine).join("\n")
      : "You do not have any reminders yet.";

    const help = buildHelpText();

    await safeReply(interaction, {
      content: `${header}\n${body}\n\n${help}`,
      ephemeral,
    });
  }

  @Slash({ description: "Snooze a reminder to another time", name: "snooze" })
  async snooze(
    @SlashOption({
      description: "Reminder id (see /remindme menu)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    reminderId: number,
    @SlashOption({
      description: "New time (e.g., 2024-12-01 09:00 ET, in 1h, in 30m)",
      name: "until",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    until: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const parsedDate = parseUserDate(until);
    if (!parsedDate) {
      await safeReply(interaction, {
        content: formatDateHelpText("Sorry, I could not understand that time."),
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const remindAt = DateTime.fromJSDate(parsedDate).toUTC();
    if (remindAt <= DateTime.utc().plus({ minutes: 1 })) {
      await safeReply(interaction, {
        content: "Snoozed time must be at least one minute in the future.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const updated = await Reminder.snooze(
      reminderId,
      interaction.user.id,
      remindAt.toJSDate(),
    );

    if (!updated) {
      await safeReply(interaction, {
        content: "I could not find that reminder for you.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

      await safeReply(interaction, {
        content: `Reminder #${updated.reminderId} snoozed to ${formatReminderTime(
          remindAt.toJSDate(),
        )}.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
  }

  @Slash({ description: "Delete a reminder", name: "delete" })
  async delete(
    @SlashOption({
      description: "Reminder id (see /remindme menu)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    reminderId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = true;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const removed = await Reminder.delete(reminderId, interaction.user.id);
    if (!removed) {
      await safeReply(interaction, {
        content: "I could not find that reminder for you.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Reminder #${reminderId} deleted.`,
      ephemeral,
    });
  }
}

@Discord()
export class RemindMeButtons {
  @ButtonComponent({ id: /^remind-(?:done|snooze)-.+/ })
  async handleReminderButtons(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseReminderButton(interaction.customId);
    if (!parsed) {
      await safeReply(interaction, {
        content: "Sorry, I could not understand that action.",
                flags: MessageFlags.Ephemeral,      });
      return;
    }

    const reminder = await Reminder.getById(parsed.reminderId);
    if (!reminder || reminder.userId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "That reminder is not available to you anymore.",
                flags: MessageFlags.Ephemeral,      });
      return;
    }

    if (parsed.kind === "done") {
      await Reminder.delete(reminder.reminderId, interaction.user.id);

      try {
        if (interaction.message?.deletable) {
          await interaction.message.delete();
          await safeReply(interaction, {
            content: `Reminder #${reminder.reminderId} marked done.`,
                    flags: MessageFlags.Ephemeral,          });
          return;
        }
      } catch (err) {
        console.warn("Could not delete reminder message:", err);
      }

      // Fallback: Remove buttons from the message
      if ((interaction as any).update) {
        try {
          await (interaction as any).update({
            content: `Reminder #${reminder.reminderId} marked done.`,
            components: [],
          });
          return;
        } catch (err) {
          console.warn("Could not update reminder message:", err);
        }
      }

      await safeReply(interaction, {
        content: `Got it. Reminder #${reminder.reminderId} is removed.`,
                flags: MessageFlags.Ephemeral,      });
      return;
    }

    const minutes = Math.max(1, Math.trunc(parsed.minutes));
    const newTime = DateTime.utc().plus({ minutes });
    const updated = await Reminder.snooze(
      reminder.reminderId,
      interaction.user.id,
      newTime.toJSDate(),
    );

    if (!updated) {
      await safeReply(interaction, {
        content: "I could not update that reminder.",
                flags: MessageFlags.Ephemeral,      });
      return;
    }

    await safeReply(interaction, {
      content: `Snoozed to ${formatReminderTime(newTime.toJSDate())}.`,
              flags: MessageFlags.Ephemeral,    });
  }
}

function parseUserDate(input: string): Date | null {
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

    const delta: { minutes?: number; hours?: number; days?: number } = {};
    delta[unit as keyof typeof delta] = amount;
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

function formatReminderLine(reminder: IReminderRecord): string {
  const status = reminder.sentAt ? "sent" : "pending";
  const noisy = reminder.isNoisy ? " (noisy)" : "";
  return `* #${reminder.reminderId} - ${reminder.content} - ${formatReminderTime(
    reminder.remindAt,
  )}${noisy} (${status})`;
}

function buildHelpText(): string {
  return (
    "**Managing reminders**\n" +
    "* Add: /remindme create when:<time> note:<text> [noisy:true]\n" +
    "* Snooze: /remindme snooze id:<id> until:<time>\n" +
    "* Delete: /remindme delete id:<id>\n" +
    "Reminders arrive in DMs with quick snooze buttons."
  );
}

function formatDateHelpText(prefix: string): string {
  return (
    `${prefix}\n` +
    "Examples: `in 45m`, `in 2h`, `2024-12-01 09:00`, " +
    "`2024-12-01T09:00-05:00`."
  );
}
