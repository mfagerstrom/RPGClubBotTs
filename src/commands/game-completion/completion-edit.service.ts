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

const MAX_NOTE_LENGTH = 500;

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
      await interaction.message
        .edit(buildCompletionEditPrompt(ownerId, completionId, updated))
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

  await interaction
    .update(buildCompletionEditPrompt(ownerId, completionId, updated))
    .catch(() => {});
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
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(fieldButtons)],
  };
}
