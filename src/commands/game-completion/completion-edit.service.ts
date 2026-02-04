import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type Message,
} from "discord.js";
import Member from "../../classes/Member.js";
import {
  COMPLETION_TYPES,
  formatDiscordTimestamp,
  formatPlaytimeHours,
  parseCompletionDateInput,
} from "../profile.command.js";
import {
  resolveGameCompletionPlatformId,
  resolveGameCompletionPlatformLabel,
} from "./completion-autocomplete.utils.js";

const MAX_NOTE_LENGTH = 500;
type CompletionEditField = "type" | "date" | "platform" | "playtime" | "note";

/**
 * Handles completion edit menu selection
 */
export async function handleCompletionEditMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This edit prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const completionId = Number(interaction.values[0]);
  if (!Number.isInteger(completionId) || completionId <= 0) {
    await interaction.reply({
      content: "Invalid selection.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const completion = await Member.getCompletion(completionId);
  if (!completion) {
    await interaction.reply({
      content: "Completion not found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const response = buildCompletionEditPrompt(ownerId, completionId, completion);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(response).catch(() => {});
  } else {
    await interaction.update(response).catch(() => {});
  }
}

/**
 * Handles the "Done" button when finishing editing
 */
export async function handleCompletionEditDone(interaction: ButtonInteraction): Promise<void> {
  const [, ownerId] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This edit prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.update({
    content: "Edit complete.",
    embeds: [],
    components: [],
  }).catch(() => {});
}

/**
 * Handles editing individual completion fields (type, date, playtime, note)
 */
export async function handleCompletionFieldEdit(interaction: ButtonInteraction): Promise<void> {
  const [, ownerId, completionIdRaw, field] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This edit prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const completionId = Number(completionIdRaw);
  if (!Number.isInteger(completionId) || completionId <= 0) {
    await interaction.reply({
      content: "Invalid selection.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (field === "type") {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`comp-edit-type-select:${ownerId}:${completionId}`)
      .setPlaceholder("Select completion type")
      .addOptions(COMPLETION_TYPES.map((t) => ({ label: t, value: t })));

    await interaction
      .update({
        content: "Select the new completion type:",
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
        embeds: interaction.message?.embeds?.length ? interaction.message.embeds : undefined,
      })
      .catch(() => {});
    return;
  }

  const prompt =
    field === "date"
      ? "Type the new completion date (e.g., 2025-12-11)."
      : field === "platform"
        ? "Type the new platform (or `clear` to remove it)."
      : field === "playtime"
        ? "Type the new final playtime in hours (e.g., 42.5)."
        : "Type the new note (or `clear` to remove it).";

  await interaction
    .update({
      content: prompt,
      components: [],
      embeds: interaction.message?.embeds?.length ? interaction.message.embeds : undefined,
    })
    .catch(() => {});

  const channel = interaction.channel;
  if (!channel || !("awaitMessages" in channel)) {
    const updated = await Member.getCompletion(completionId);
    if (updated) {
      await interaction.message
        .edit(
          buildCompletionEditPrompt(
            ownerId,
            completionId,
            updated,
            "I couldn't listen for your response in this channel.",
          ),
        )
        .catch(() => {});
    }
    return;
  }

  const collected = await (channel as any)
    .awaitMessages({
      filter: (m: Message) => m.author.id === interaction.user.id,
      max: 1,
      time: 60_000,
    })
    .catch(() => null);

  const message = collected?.first();
  if (!message) {
    const updated = await Member.getCompletion(completionId);
    if (updated) {
      await interaction.message
        .edit(
          buildCompletionEditPrompt(
            ownerId,
            completionId,
            updated,
            "Timed out waiting for your response.",
          ),
        )
        .catch(() => {});
    }
    return;
  }

  const value = message.content.trim();
  try {
    if (field === "date") {
      const dt = parseCompletionDateInput(value);
      await Member.updateCompletion(ownerId, completionId, { completedAt: dt });
    } else if (field === "platform") {
      if (/^clear$/i.test(value)) {
        await Member.updateCompletion(ownerId, completionId, { platformId: null });
      } else {
        const platformId = await resolveGameCompletionPlatformId(value);
        if (platformId == null) {
          throw new Error("Platform not found. Use the platform autocomplete in `/game-completion add`.");
        }
        await Member.updateCompletion(ownerId, completionId, { platformId });
      }
    } else if (field === "playtime") {
      const num = Number(value);
      if (Number.isNaN(num) || num < 0)
        throw new Error("Playtime must be a non-negative number.");
      await Member.updateCompletion(ownerId, completionId, { finalPlaytimeHours: num });
    } else if (field === "note") {
      if (/^clear$/i.test(value)) {
        await Member.updateCompletion(ownerId, completionId, { note: null });
      } else if (value.length > MAX_NOTE_LENGTH) {
        throw new Error(`Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
      } else {
        await Member.updateCompletion(ownerId, completionId, { note: value });
      }
    }
    const updated = await Member.getCompletion(completionId);
    if (updated) {
      const notice = await buildCompletionEditSuccessNotice(updated, field as CompletionEditField);
      await interaction.message
        .edit(buildCompletionEditPrompt(ownerId, completionId, updated, notice))
        .catch(() => {});
    }
  } catch (err: any) {
    const updated = await Member.getCompletion(completionId);
    if (updated) {
      await interaction.message
        .edit(
          buildCompletionEditPrompt(
            ownerId,
            completionId,
            updated,
            err?.message ?? "Failed to update completion.",
          ),
        )
        .catch(() => {});
    }
  } finally {
    try {
      await message.delete().catch(() => {});
    } catch {
      // ignore
    }
  }
}

/**
 * Handles completion type selection from dropdown
 */
export async function handleCompletionTypeSelect(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const [, ownerId, completionIdRaw] = interaction.customId.split(":");
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: "This edit prompt isn't for you.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const completionId = Number(completionIdRaw);
  const value = interaction.values[0];
  const normalized = COMPLETION_TYPES.find((t) => t.toLowerCase() === value.toLowerCase());

  if (!normalized) {
    const updated = await Member.getCompletion(completionId);
    if (updated) {
      await interaction
        .update(
          buildCompletionEditPrompt(
            ownerId,
            completionId,
            updated,
            "Invalid completion type selected.",
          ),
        )
        .catch(() => {});
    }
    return;
  }

  await Member.updateCompletion(ownerId, completionId, { completionType: normalized });

  const updated = await Member.getCompletion(completionId);
  if (!updated) {
    await interaction
      .update({
        content: "Completion not found.",
        embeds: [],
        components: [],
      })
      .catch(() => {});
    return;
  }

  const notice = await buildCompletionEditSuccessNotice(updated, "type");
  await interaction
    .update(buildCompletionEditPrompt(ownerId, completionId, updated, notice))
    .catch(() => {});
}

async function buildCompletionEditSuccessNotice(
  completion: Awaited<ReturnType<typeof Member.getCompletion>>,
  field: CompletionEditField,
): Promise<string> {
  if (!completion) return "Saved update.";

  const fieldLabel = getCompletionEditFieldLabel(field);
  const valueLabel = await getCompletionEditValueLabel(completion, field);
  return `Saved: **${completion.title}** - ${fieldLabel} updated to **${valueLabel}**.`;
}

function getCompletionEditFieldLabel(field: CompletionEditField): string {
  if (field === "type") return "Completion Type";
  if (field === "date") return "Completion Date";
  if (field === "platform") return "Platform";
  if (field === "playtime") return "Final Playtime";
  return "Note";
}

async function getCompletionEditValueLabel(
  completion: Awaited<ReturnType<typeof Member.getCompletion>>,
  field: CompletionEditField,
): Promise<string> {
  if (!completion) return "Unknown";
  if (field === "type") return completion.completionType;
  if (field === "date") {
    return completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date";
  }
  if (field === "platform") {
    return await resolveGameCompletionPlatformLabel(completion.platformId);
  }
  if (field === "playtime") {
    return completion.finalPlaytimeHours != null
      ? (formatPlaytimeHours(completion.finalPlaytimeHours) ?? "No playtime")
      : "No playtime";
  }
  if (!completion.note) return "No note";
  const compact = completion.note.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

/**
 * Builds the edit prompt with current completion details and edit buttons
 */
function buildCompletionEditPrompt(
  ownerId: string,
  completionId: number,
  completion: Awaited<ReturnType<typeof Member.getCompletion>>,
  notice?: string | null,
): {
  content: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  if (!completion) {
    return {
      content: "Completion not found.",
      embeds: [],
      components: [],
    };
  }

  const fieldButtons = [
    new ButtonBuilder()
      .setCustomId(`comp-edit-field:${ownerId}:${completionId}:type`)
      .setLabel("Completion Type")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`comp-edit-field:${ownerId}:${completionId}:date`)
      .setLabel("Completion Date")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`comp-edit-field:${ownerId}:${completionId}:platform`)
      .setLabel("Platform")
      .setStyle(ButtonStyle.Secondary),
  ];

  const secondaryButtons = [
    new ButtonBuilder()
      .setCustomId(`comp-edit-field:${ownerId}:${completionId}:playtime`)
      .setLabel("Final Playtime")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`comp-edit-field:${ownerId}:${completionId}:note`)
      .setLabel("Note")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`comp-edit-done:${ownerId}:${completionId}`)
      .setLabel("Done")
      .setStyle(ButtonStyle.Success),
  ];

  const currentParts = [
    completion.completionType,
    completion.completedAt ? formatDiscordTimestamp(completion.completedAt) : "No date",
    completion.platformId != null ? `Platform #${completion.platformId}` : "No platform",
    completion.finalPlaytimeHours != null
      ? formatPlaytimeHours(completion.finalPlaytimeHours)
      : null,
  ].filter(Boolean);
  const noteLine = completion.note ? `\n> ${completion.note}` : "";

  const noticeLine = notice ? `${notice}\n` : "";
  return {
    content: `${noticeLine}Editing **${completion.title}** — choose a field to update:`,
    embeds: [
      new EmbedBuilder().setDescription(`Current: ${currentParts.join(" — ")}${noteLine}`),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(fieldButtons),
      new ActionRowBuilder<ButtonBuilder>().addComponents(secondaryButtons),
    ],
  };
}
