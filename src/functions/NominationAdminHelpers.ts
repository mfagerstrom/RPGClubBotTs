import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type RepliableInteraction,
  type TextBasedChannel,
} from "discord.js";
import {
  GOTM_NOMINATION_CHANNEL_ID,
  NR_GOTM_NOMINATION_CHANNEL_ID,
} from "../config/nominationChannels.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
  type INominationEntry,
  type NominationKind,
} from "../classes/Nomination.js";
import {
  getUpcomingNominationWindow,
  type INominationWindow,
} from "./NominationWindow.js";
import { safeUpdate } from "./InteractionUtils.js";

export async function buildNominationDeleteView(
  kind: NominationKind,
  commandLabel: string,
  promptPrefix: string,
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<ButtonBuilder>[] } | null> {
  const window = await getUpcomingNominationWindow();
  const nominations = await listNominationsForRound(kind, window.targetRound);
  if (!nominations.length) return null;

  const embed = buildNominationEmbed(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    commandLabel,
    window,
    nominations,
  );
  const components = buildDeletionComponents(kind, window.targetRound, nominations, promptPrefix);
  return { embed, components };
}

export function buildNominationDeleteViewEmbed(
  kindLabel: string,
  commandLabel: string,
  targetRound: number,
  window: INominationWindow,
  nominations: INominationEntry[],
): EmbedBuilder {
  const windowWithRound: INominationWindow & { targetRound: number } = {
    ...window,
    targetRound,
  };
  return buildNominationEmbed(kindLabel, commandLabel, windowWithRound, nominations);
}

export function buildNominationEmbed(
  kindLabel: string,
  commandLabel: string,
  window: INominationWindow & { targetRound: number },
  nominations: INominationEntry[],
): EmbedBuilder {
  const lines =
    nominations.length > 0
      ? nominations.map((n, idx) => {
          const reason = n.reason ? `\n> Reason: ${n.reason}` : "";
          return `${numberEmoji(idx + 1)} ${n.gameTitle} — <@${n.userId}>${reason}`;
        })
      : ["No nominations yet."];

  const voteLabel = formatDate(window.nextVoteAt);

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${kindLabel} Nominations - Round ${window.targetRound}`)
    .setDescription(lines.join("\n"))
    .setFooter({
      text:
        `Vote on ${voteLabel}\n` +
        `Do you want to nominate a game? Use ${commandLabel}`,
    });
}

export function buildDeletionComponents(
  kind: NominationKind,
  round: number,
  nominations: INominationEntry[],
  prefix: string,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const chunk: ButtonBuilder[] = [];

  nominations.forEach((n, idx) => {
    const btn = new ButtonBuilder()
      .setCustomId(`${prefix}-${kind}-nom-del-${round}-${n.userId}`)
      .setLabel(numberEmoji(idx + 1))
      .setStyle(ButtonStyle.Danger);
    chunk.push(btn);
    if (chunk.length === 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(chunk.splice(0)));
    }
  });

  if (chunk.length) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(chunk));
  }

  return rows;
}

export async function handleNominationDeletionButton(
  interaction: ButtonInteraction,
  kind: NominationKind,
  round: number,
  userId: string,
  prefix: string,
): Promise<void> {
  const nomination = await getNominationForUser(kind, round, userId);
  if (!nomination) {
    await safeUpdate(interaction, {
      content: `No ${kind.toUpperCase()} nomination found for Round ${round} and user <@${userId}>.`,
      components: [],
      embeds: [],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await deleteNominationForUser(kind, round, userId);

  const window = await getUpcomingNominationWindow();
  const windowForRound: INominationWindow & { targetRound: number } = {
    ...window,
    targetRound: round,
  };
  const nominations = await listNominationsForRound(kind, round);
  const embed = buildNominationEmbed(
    kind === "gotm" ? "GOTM" : "NR-GOTM",
    `/${kind} nominate`,
    windowForRound,
    nominations,
  );

  const content = `<@${interaction.user.id}> deleted <@${userId}>'s nomination "${nomination.gameTitle}" for ${kind.toUpperCase()} Round ${round}.`;
  const components = buildDeletionComponents(kind, round, nominations, prefix);

  await safeUpdate(interaction, {
    content,
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });

  await announceNominationChange(kind, interaction, content, embed);
}

export async function announceNominationChange(
  kind: NominationKind,
  interaction: RepliableInteraction,
  content: string,
  embed: EmbedBuilder,
): Promise<void> {
  const channelId =
    kind === "gotm" ? GOTM_NOMINATION_CHANNEL_ID : NR_GOTM_NOMINATION_CHANNEL_ID;

  try {
    const channel = await (interaction.client as any).channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased()
      ? (channel as TextBasedChannel)
      : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) return;
    await textChannel.send({ content, embeds: [embed] });
  } catch (err) {
    console.error(`Failed to announce nomination change in channel ${channelId}:`, err);
  }
}

function isSendableTextChannel(channel: TextBasedChannel | null): channel is TextBasedChannel & {
  send: (content: any) => Promise<any>;
} {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function numberEmoji(n: number): string {
  const lookup: Record<number, string> = {
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

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}
