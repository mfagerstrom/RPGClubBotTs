import type { CommandInteraction } from "discord.js";

// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(interaction: CommandInteraction): Promise<void> {
  const anyInteraction = interaction as any;

  // Custom flag so our helpers can reliably detect an acknowledgement
  if (anyInteraction.__rpgAcked || anyInteraction.deferred || anyInteraction.replied) {
    return;
  }

  try {
    if (typeof anyInteraction.deferReply === "function") {
      await anyInteraction.deferReply();
      anyInteraction.__rpgAcked = true;
      anyInteraction.__rpgDeferred = true;
    }
  } catch {
    // ignore errors from deferReply (e.g., already acknowledged)
  }
}

// Ensure we do not hit "Interaction already acknowledged" when replying
export async function safeReply(interaction: CommandInteraction, options: any): Promise<void> {
  const anyInteraction = interaction as any;

  const deferred: boolean = Boolean(
    anyInteraction.__rpgDeferred !== undefined
      ? anyInteraction.__rpgDeferred
      : anyInteraction.deferred,
  );
  const replied: boolean = Boolean(anyInteraction.replied);
  const acked: boolean = Boolean(anyInteraction.__rpgAcked ?? deferred ?? replied);

  const isAckError = (err: any): boolean => {
    const code = err?.code ?? err?.rawError?.code;
    return code === 40060 || code === 10062;
  };

  // If we've deferred but not yet replied, edit the original reply
  if (deferred && !replied) {
    try {
      if (typeof options === "string") {
        await interaction.editReply({ content: options });
      } else {
        const { ephemeral, ...rest } = options ?? {};
        await interaction.editReply(rest as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // If we've already replied, or we know the interaction was acknowledged,
  // send a follow-up message instead of trying to reply again.
  if (replied || acked) {
    try {
      if (typeof options === "string") {
        await interaction.followUp({ content: options });
      } else {
        const { ephemeral, ...rest } = options ?? {};
        await interaction.followUp(rest as any);
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
      await interaction.reply(options as any);
    }
    anyInteraction.__rpgAcked = true;
  } catch (err: any) {
    if (!isAckError(err)) throw err;
  }
}
