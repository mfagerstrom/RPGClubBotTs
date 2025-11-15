// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(interaction) {
    const anyInteraction = interaction;
    if (anyInteraction.deferred || anyInteraction.replied) {
        return;
    }
    try {
        if (typeof anyInteraction.deferReply === "function") {
            await anyInteraction.deferReply();
        }
    }
    catch {
        // ignore errors from deferReply (e.g., already acknowledged)
    }
}
// Ensure we do not hit "Interaction already acknowledged" when replying
export async function safeReply(interaction, options) {
    const anyInteraction = interaction;
    const deferred = anyInteraction.deferred;
    const replied = anyInteraction.replied;
    if (deferred && !replied) {
        if (typeof options === "string") {
            await interaction.editReply({ content: options });
            return;
        }
        const { ephemeral, ...rest } = options ?? {};
        await interaction.editReply(rest);
        return;
    }
    if (replied || deferred) {
        if (typeof options === "string") {
            await interaction.followUp({ content: options });
            return;
        }
        const { ephemeral, ...rest } = options ?? {};
        await interaction.followUp(rest);
        return;
    }
    if (typeof options === "string") {
        await interaction.reply({ content: options });
        return;
    }
    await interaction.reply(options);
}
