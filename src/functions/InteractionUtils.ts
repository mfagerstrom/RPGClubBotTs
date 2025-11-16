import { MessageFlags } from "discord.js";
import type {
  CommandInteraction,
  InteractionDeferReplyOptions,
  RepliableInteraction,
} from "discord.js";

export type AnyRepliable = RepliableInteraction | CommandInteraction;

function normalizeOptions(options: any): any {
  if (typeof options === "string" || options === null || options === undefined) {
    return options;
  }

  const { __forceFollowUp, ...restOptions } = options as any;

  if ("ephemeral" in options) {
    const { ephemeral, flags, ...rest } = restOptions as any;
    const newFlags = ephemeral ? ((flags ?? 0) | MessageFlags.Ephemeral) : flags;
    return { ...rest, flags: newFlags };
  }

  return restOptions;
}

// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(
  interaction: AnyRepliable,
  options?: InteractionDeferReplyOptions,
): Promise<void> {
  const anyInteraction = interaction as any;

  // Custom flag so our helpers can reliably detect an acknowledgement
  if (anyInteraction.__rpgAcked || anyInteraction.deferred || anyInteraction.replied) {
    return;
  }

  try {
    if (typeof anyInteraction.deferReply === "function") {
      await anyInteraction.deferReply(options);
      anyInteraction.__rpgAcked = true;
      anyInteraction.__rpgDeferred = true;
    }
  } catch {
    // ignore errors from deferReply (e.g., already acknowledged)
  }
}

// Ensure we do not hit "Interaction already acknowledged" when replying
const isAckError = (err: any): boolean => {
  const code = err?.code ?? err?.rawError?.code;
  return code === 40060 || code === 10062;
};

export async function safeReply(interaction: AnyRepliable, options: any): Promise<void> {
  const anyInteraction = interaction as any;
  const forceFollowUp = Boolean(options?.__forceFollowUp);
  const normalizedOptions = normalizeOptions(options);

  const deferred: boolean = Boolean(
    anyInteraction.__rpgDeferred !== undefined
      ? anyInteraction.__rpgDeferred
      : anyInteraction.deferred,
  );
  const replied: boolean = Boolean(anyInteraction.replied);
  const acked: boolean = Boolean(anyInteraction.__rpgAcked ?? deferred ?? replied);

  // If we've deferred but not yet replied, edit the original reply
  if (deferred && !replied) {
    try {
      if (typeof options === "string") {
        await interaction.editReply({ content: options });
      } else {
        const { ephemeral, ...rest } = normalizedOptions ?? {};
        await interaction.editReply(rest as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // If we've already replied, or we know the interaction was acknowledged,
  // send a follow-up message instead of trying to reply again.
  if (replied || acked || forceFollowUp) {
    try {
      if (typeof options === "string") {
        await interaction.followUp({ content: options });
      } else {
        await interaction.followUp(normalizedOptions as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // First-time acknowledgement: normal reply
  try {
    if (typeof options === "string") {
      await interaction.reply({ content: options });
    } else {
      await interaction.reply(normalizedOptions as any);
    }
    anyInteraction.__rpgAcked = true;
  } catch (err: any) {
    if (!isAckError(err)) throw err;
  }
}

// Try to update an existing interaction message; fall back to a normal reply if needed.
export async function safeUpdate(interaction: AnyRepliable, options: any): Promise<void> {
  const anyInteraction = interaction as any;
  const normalizedOptions = normalizeOptions(options);

  if (typeof anyInteraction.update === "function") {
    try {
      await anyInteraction.update(normalizedOptions);
      anyInteraction.__rpgAcked = true;
      anyInteraction.__rpgDeferred = false;
      return;
    } catch (err: any) {
      if (!isAckError(err)) {
        // Fall back to follow-up path below
      } else {
        return;
      }
    }
  }

  await safeReply(interaction, { ...normalizedOptions, ephemeral: true });
}
