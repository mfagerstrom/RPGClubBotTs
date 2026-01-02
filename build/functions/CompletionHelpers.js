import { EmbedBuilder, MessageFlags, } from "discord.js";
import { applyGameDbThumbnail, buildGameDbThumbAttachment, formatPlaytimeHours, formatTableDate, } from "../commands/profile.command.js";
import Game from "../classes/Game.js";
import Member from "../classes/Member.js";
const ANNOUNCEMENT_CHANNEL_ID = "360819470836695042";
export async function saveCompletion(interaction, userId, gameId, completionType, completedAt, finalPlaytimeHours, note, gameTitle, announce, isAdminOverride = false) {
    if (interaction.user.id !== userId && !isAdminOverride) {
        await interaction.followUp({
            content: "You can only log completions for yourself.",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    const game = await Game.getGameById(gameId);
    if (!game) {
        await interaction.followUp({
            content: `GameDB #${gameId} was not found.`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    try {
        await Member.addCompletion({
            userId,
            gameId,
            completionType,
            completedAt,
            finalPlaytimeHours,
            note,
        });
    }
    catch (err) {
        const msg = err?.message ?? "Failed to save completion.";
        await interaction.followUp({
            content: `Could not save completion: ${msg}`,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    try {
        await Member.removeNowPlaying(userId, gameId);
    }
    catch {
        // Ignore cleanup errors
    }
    const playtimeText = formatPlaytimeHours(finalPlaytimeHours);
    const details = [completionType, playtimeText].filter(Boolean).join(" — ");
    await interaction.followUp({
        content: `Logged completion for **${gameTitle ?? game.title}** (${details}).`,
        flags: MessageFlags.Ephemeral,
    });
    if (announce) {
        try {
            const channel = await interaction.client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID);
            if (channel && "send" in channel) {
                // Fetch the user who actually completed the game, not necessarily the interaction user
                const user = await interaction.client.users.fetch(userId).catch(() => null);
                if (user) {
                    const completions = await Game.getGameCompletions(gameId);
                    const isFirst = completions.length === 1;
                    const dateStr = completedAt ? formatTableDate(completedAt) : "No date";
                    const hoursStr = playtimeText ? ` - ${playtimeText}` : "";
                    let desc = `<@${user.id}> has added a game completion: **${game.title}** - ${completionType} - ${dateStr}${hoursStr}`;
                    if (isAdminOverride && interaction.user.id !== userId) {
                        desc = `<@${interaction.user.id}> added a game completion for <@${user.id}>: **${game.title}** - ${completionType} - ${dateStr}${hoursStr}`;
                    }
                    const embed = new EmbedBuilder()
                        .setAuthor({
                        name: user.displayName ?? user.username,
                        iconURL: user.displayAvatarURL(),
                    })
                        .setDescription(desc)
                        .setColor(0x00ff00);
                    applyGameDbThumbnail(embed);
                    if (isFirst) {
                        embed.addFields({
                            name: "First Completion!",
                            value: "This is the first recorded completion for this game in the club!",
                        });
                    }
                    await channel.send({
                        embeds: [embed],
                        files: [buildGameDbThumbAttachment()],
                    });
                }
            }
        }
        catch (err) {
            console.error("Failed to announce completion:", err);
        }
    }
}
