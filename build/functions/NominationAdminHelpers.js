import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, } from "discord.js";
import { GOTM_NOMINATION_CHANNEL_ID, NR_GOTM_NOMINATION_CHANNEL_ID, } from "../config/nominationChannels.js";
import { deleteNominationForUser, getNominationForUser, listNominationsForRound, } from "../classes/Nomination.js";
import { getUpcomingNominationWindow, } from "./NominationWindow.js";
import { safeUpdate } from "./InteractionUtils.js";
export async function buildNominationDeleteView(kind, commandLabel, promptPrefix) {
    const window = await getUpcomingNominationWindow();
    const nominations = await listNominationsForRound(kind, window.targetRound);
    if (!nominations.length)
        return null;
    const embed = buildNominationEmbed(kind === "gotm" ? "GOTM" : "NR-GOTM", commandLabel, window, nominations);
    const components = buildDeletionComponents(kind, window.targetRound, nominations, promptPrefix);
    return { embed, components };
}
export function buildNominationDeleteViewEmbed(kindLabel, commandLabel, targetRound, window, nominations) {
    const windowWithRound = {
        ...window,
        targetRound,
    };
    return buildNominationEmbed(kindLabel, commandLabel, windowWithRound, nominations);
}
export function buildNominationEmbed(kindLabel, commandLabel, window, nominations) {
    const lines = nominations.length > 0
        ? nominations.map((n, idx) => `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>`)
        : ["No nominations yet."];
    const voteLabel = formatDate(window.nextVoteAt);
    return new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle(`${kindLabel} Nominations - Round ${window.targetRound}`)
        .setDescription(lines.join("\n"))
        .setFooter({
        text: `Vote on ${voteLabel}\n` +
            `Do you want to nominate a game? Use ${commandLabel}`,
    });
}
export function buildDeletionComponents(kind, round, nominations, prefix) {
    const rows = [];
    const chunk = [];
    nominations.forEach((n, idx) => {
        const btn = new ButtonBuilder()
            .setCustomId(`${prefix}-${kind}-nom-del-${round}-${n.userId}`)
            .setLabel(numberEmoji(idx + 1))
            .setStyle(ButtonStyle.Danger);
        chunk.push(btn);
        if (chunk.length === 5) {
            rows.push(new ActionRowBuilder().addComponents(chunk.splice(0)));
        }
    });
    if (chunk.length) {
        rows.push(new ActionRowBuilder().addComponents(chunk));
    }
    return rows;
}
export async function handleNominationDeletionButton(interaction, kind, round, userId, prefix) {
    const nomination = await getNominationForUser(kind, round, userId);
    if (!nomination) {
        await safeUpdate(interaction, {
            content: `No ${kind.toUpperCase()} nomination found for Round ${round} and user <@${userId}>.`,
            components: [],
            embeds: [],
            ephemeral: true,
        });
        return;
    }
    await deleteNominationForUser(kind, round, userId);
    const window = await getUpcomingNominationWindow();
    const windowForRound = {
        ...window,
        targetRound: round,
    };
    const nominations = await listNominationsForRound(kind, round);
    const embed = buildNominationEmbed(kind === "gotm" ? "GOTM" : "NR-GOTM", `/${kind} nominate`, windowForRound, nominations);
    const content = `<@${interaction.user.id}> deleted <@${userId}>'s nomination "${nomination.gameTitle}" for ${kind.toUpperCase()} Round ${round}.`;
    const components = buildDeletionComponents(kind, round, nominations, prefix);
    await safeUpdate(interaction, {
        content,
        embeds: [embed],
        components,
        ephemeral: true,
    });
    await announceNominationChange(kind, interaction, content, embed);
}
export async function announceNominationChange(kind, interaction, content, embed) {
    const channelId = kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;
    try {
        const channel = await interaction.client.channels.fetch(channelId);
        const textChannel = channel?.isTextBased()
            ? channel
            : null;
        if (!textChannel || !isSendableTextChannel(textChannel))
            return;
        await textChannel.send({ content, embeds: [embed] });
    }
    catch (err) {
        console.error(`Failed to announce nomination change in channel ${channelId}:`, err);
    }
}
function isSendableTextChannel(channel) {
    return Boolean(channel && typeof channel.send === "function");
}
function numberEmoji(n) {
    const lookup = {
        1: ":one:",
        2: ":two:",
        3: ":three:",
        4: ":four:",
        5: ":five:",
        6: ":six:",
        7: ":seven:",
        8: ":eight:",
        9: ":nine:",
        10: ":keycap_ten:",
    };
    return lookup[n] ?? `${n}.`;
}
function formatDate(date) {
    return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}
