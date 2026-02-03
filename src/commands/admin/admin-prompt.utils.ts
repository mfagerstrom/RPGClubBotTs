import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  type Message,
  type CommandInteraction,
} from "discord.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { type PromptChoiceOption } from "./admin.types.js";

export function buildChoiceRows(
  customIdPrefix: string,
  options: PromptChoiceOption[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((opt) =>
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}:${opt.value}`)
          .setLabel(opt.label)
          .setStyle(opt.style ?? ButtonStyle.Secondary),
      ),
    );
    rows.push(row);
  }
  return rows;
}

export function buildNumberChoiceOptions(min: number, max: number): PromptChoiceOption[] {
  const options: PromptChoiceOption[] = [];
  for (let i = min; i <= max; i++) {
    options.push({ label: String(i), value: String(i), style: ButtonStyle.Primary });
  }
  return options;
}

export function addCancelOption(options: PromptChoiceOption[]): PromptChoiceOption[] {
  return [...options, { label: "Cancel", value: "cancel", style: ButtonStyle.Danger }];
}

export async function promptUserForChoice(
  interaction: CommandInteraction,
  question: string,
  options: PromptChoiceOption[],
  timeoutMs = 120_000,
  cancelMessage = "Cancelled.",
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.send !== "function") {
    await safeReply(interaction, {
      content: "Cannot prompt for additional input; this command must be used in a text channel.",
    });
    return null;
  }

  const promptId = `admin-choice:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const rows = buildChoiceRows(promptId, options);
  const content = `<@${userId}> ${question}`;

  let promptMessage: Message | null = null;
  try {
    const reply = await safeReply(interaction, {
      content,
      components: rows,
      __forceFollowUp: true,
    });
    if (reply && typeof (reply as Message).awaitMessageComponent === "function") {
      promptMessage = reply as Message;
    }
  } catch {
    // fall back to channel.send below
  }

  if (!promptMessage) {
    promptMessage = await channel.send({
      content,
      components: rows,
      allowedMentions: { users: [userId] },
    }).catch(() => null);
  }

  if (!promptMessage) {
    await safeReply(interaction, {
      content: "Failed to send the prompt message.",
    });
    return null;
  }

  try {
    const selection = await promptMessage.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === userId && i.customId.startsWith(`${promptId}:`),
      time: timeoutMs,
    });
    await selection.deferUpdate().catch(() => {});
    const value = selection.customId.slice(promptId.length + 1);
    await promptMessage.edit({ components: [] }).catch(() => {});
    if (value === "cancel") {
      await safeReply(interaction, { content: cancelMessage });
      return null;
    }
    return value;
  } catch {
    await promptMessage.edit({ components: [] }).catch(() => {});
    await safeReply(interaction, { content: "Timed out waiting for a selection. Cancelled." });
    return null;
  }
}

export async function promptUserForInput(
  interaction: CommandInteraction,
  question: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.awaitMessages !== "function") {
    await safeReply(interaction, {
      content: "Cannot prompt for additional input; this command must be used in a text channel.",
    });
    return null;
  }

  try {
    await safeReply(interaction, {
      content: `<@${userId}> ${question}`,
    });
  } catch (err) {
    console.error("Failed to send prompt message:", err);
  }

  try {
    const collected = await channel.awaitMessages({
      filter: (m: any) => m.author?.id === userId,
      max: 1,
      time: timeoutMs,
    });

    const first = collected?.first?.();
    if (!first) {
      await safeReply(interaction, {
        content: "Timed out waiting for a response. Edit cancelled.",
      });
      return null;
    }

    const content: string = (first.content ?? "").trim();
    if (!content) {
      await safeReply(interaction, {
        content: "Empty response received. Edit cancelled.",
      });
      return null;
    }

    if (/^cancel$/i.test(content)) {
      await safeReply(interaction, {
        content: "Edit cancelled.",
      });
      return null;
    }

    return content;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    try {
      await safeReply(interaction, {
        content: `Error while waiting for a response: ${msg}`,
      });
    } catch {
      // ignore
    }
    return null;
  }
}
