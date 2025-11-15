// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(interaction) {
    const anyInteraction = interaction;
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
    }
    catch {
        // ignore errors from deferReply (e.g., already acknowledged)
    }
}
// Ensure we do not hit "Interaction already acknowledged" when replying
export async function safeReply(interaction, options) {
    const anyInteraction = interaction;
    const deferred = Boolean(anyInteraction.__rpgDeferred !== undefined
        ? anyInteraction.__rpgDeferred
        : anyInteraction.deferred);
    const replied = Boolean(anyInteraction.replied);
    const acked = Boolean(anyInteraction.__rpgAcked ?? deferred ?? replied);
    const isAckError = (err) => {
        const code = err?.code ?? err?.rawError?.code;
        return code === 40060 || code === 10062;
    };
    // If we've deferred but not yet replied, edit the original reply
    if (deferred && !replied) {
        try {
            if (typeof options === "string") {
                await interaction.editReply({ content: options });
            }
            else {
                const { ephemeral, ...rest } = options ?? {};
                await interaction.editReply(rest);
            }
        }
        catch (err) {
            if (!isAckError(err))
                throw err;
        }
        return;
    }
    // If we've already replied, or we know the interaction was acknowledged,
    // send a follow-up message instead of trying to reply again.
    if (replied || acked) {
        try {
            if (typeof options === "string") {
                await interaction.followUp({ content: options });
            }
            else {
                const { ephemeral, ...rest } = options ?? {};
                await interaction.followUp(rest);
            }
        }
        catch (err) {
            if (!isAckError(err))
                throw err;
        }
        return;
    }
    // First-time acknowledgement: normal reply
    try {
        if (typeof options === "string") {
            await interaction.reply({ content: options });
        }
        else {
            await interaction.reply(options);
        }
        anyInteraction.__rpgAcked = true;
    }
    catch (err) {
        if (!isAckError(err))
            throw err;
    }
}
