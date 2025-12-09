import { MessageFlags } from "discord.js";
function normalizeOptions(options) {
    if (typeof options === "string" || options === null || options === undefined) {
        return options;
    }
    const { __forceFollowUp: _forceFollowUp, ...restOptions } = options;
    void _forceFollowUp;
    if ("ephemeral" in options) {
        const { ephemeral, flags, ...rest } = restOptions;
        const newFlags = ephemeral ? ((flags ?? 0) | MessageFlags.Ephemeral) : flags;
        return { ...rest, flags: newFlags };
    }
    return restOptions;
}
// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(interaction, options) {
    const anyInteraction = interaction;
    let deferOptions = options;
    try {
        if (!deferOptions &&
            typeof interaction.isChatInputCommand === "function" &&
            interaction.isChatInputCommand() &&
            ["admin", "mod", "superadmin"].includes(interaction.commandName)) {
            deferOptions = { flags: MessageFlags.Ephemeral };
        }
    }
    catch {
        // ignore detection issues
    }
    // Custom flag so our helpers can reliably detect an acknowledgement
    if (anyInteraction.__rpgAcked || anyInteraction.deferred || anyInteraction.replied) {
        return;
    }
    try {
        if (typeof anyInteraction.deferReply === "function") {
            const normalized = deferOptions ? normalizeOptions(deferOptions) : deferOptions;
            await anyInteraction.deferReply(normalized);
            anyInteraction.__rpgAcked = true;
            anyInteraction.__rpgDeferred = true;
        }
    }
    catch {
        // ignore errors from deferReply (e.g., already acknowledged)
    }
}
// Ensure we do not hit "Interaction already acknowledged" when replying
const isAckError = (err) => {
    const code = err?.code ?? err?.rawError?.code;
    return code === 40060 || code === 10062;
};
export async function safeReply(interaction, options) {
    const anyInteraction = interaction;
    const forceFollowUp = Boolean(options?.__forceFollowUp);
    const normalizedOptions = normalizeOptions(options);
    const deferred = Boolean(anyInteraction.__rpgDeferred !== undefined
        ? anyInteraction.__rpgDeferred
        : anyInteraction.deferred);
    const replied = Boolean(anyInteraction.replied);
    const acked = Boolean(anyInteraction.__rpgAcked ?? deferred ?? replied);
    if (forceFollowUp) {
        try {
            if (typeof options === "string") {
                return await interaction.followUp({ content: options });
            }
            else {
                return await interaction.followUp(normalizedOptions);
            }
        }
        catch (err) {
            if (!isAckError(err))
                throw err;
        }
        return;
    }
    // If we've deferred but not yet replied, edit the original reply
    if (deferred && !replied) {
        try {
            if (typeof options === "string") {
                return await interaction.editReply({ content: options });
            }
            else {
                return await interaction.editReply(normalizedOptions);
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
    if (replied || acked || forceFollowUp) {
        try {
            if (typeof options === "string") {
                return await interaction.followUp({ content: options });
            }
            else {
                return await interaction.followUp(normalizedOptions);
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
        // Force fetchReply so we can return the message
        const replyOptions = typeof options === "string"
            ? { content: options, fetchReply: true }
            : { ...normalizedOptions, fetchReply: true };
        const result = await interaction.reply(replyOptions);
        anyInteraction.__rpgAcked = true;
        return result;
    }
    catch (err) {
        if (!isAckError(err))
            throw err;
    }
}
// Try to update an existing interaction message; fall back to a normal reply if needed.
export async function safeUpdate(interaction, options) {
    const anyInteraction = interaction;
    const normalizedOptions = normalizeOptions(options);
    if (typeof anyInteraction.update === "function") {
        try {
            await anyInteraction.update(normalizedOptions);
            anyInteraction.__rpgAcked = true;
            anyInteraction.__rpgDeferred = false;
            return;
        }
        catch (err) {
            if (!isAckError(err)) {
                // Fall back to follow-up path below
            }
            else {
                return;
            }
        }
    }
    await safeReply(interaction, { ...normalizedOptions, ephemeral: true });
}
