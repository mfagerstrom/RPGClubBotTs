import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  EmbedBuilder,
  type User,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import Member, { type IMemberNowPlayingEntry } from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

function formatEntry(
  entry: IMemberNowPlayingEntry,
  guildId: string | null,
): string {
  if (entry.threadId && guildId) {
    return `[${entry.title}](https://discord.com/channels/${guildId}/${entry.threadId})`;
  }
  return entry.title;
}

function chunkLines(lines: string[], maxLength: number = 3800): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current.length ? `${current}\n${line}` : line;
    if (next.length > maxLength && current.length > 0) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = next;
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

@Discord()
export class NowPlayingCommand {
  @Slash({ description: "Show now playing data", name: "now-playing" })
  async nowPlaying(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show everyone with Now Playing entries.",
      name: "all",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showAll: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const showAllFlag = showAll === true;
    const target = member ?? interaction.user;
    const ephemeral = !showAllFlag;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    if (showAllFlag) {
      await this.showEveryone(interaction, ephemeral);
      return;
    }

    await this.showSingle(interaction, target, ephemeral);
  }

  private async showSingle(
    interaction: CommandInteraction,
    target: User,
    ephemeral: boolean,
  ): Promise<void> {
    const entries = await Member.getNowPlaying(target.id);
    if (!entries.length) {
      await safeReply(interaction, {
        content: `No Now Playing entries found for <@${target.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const lines = entries.map(
      (entry, idx) => `${idx + 1}. ${formatEntry(entry, interaction.guildId)}`,
    );

    const footerText = target.tag || target.username || target.id;
    const embed = new EmbedBuilder()
      .setTitle("Now Playing")
      .setDescription(lines.join("\n"))
      .setFooter({ text: footerText });

    await safeReply(interaction, {
      content: `<@${target.id}>`,
      embeds: [embed],
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async showEveryone(
    interaction: CommandInteraction,
    ephemeral: boolean,
  ): Promise<void> {
    const lists = await Member.getAllNowPlaying();
    if (!lists.length) {
      await safeReply(interaction, {
        content: "No Now Playing data found for anyone yet.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const lines = lists.map((record, idx) => {
      const displayName =
        record.globalName ?? record.username ?? `Member ${idx + 1}`;
      const games = record.entries
        .map((entry) => formatEntry(entry, interaction.guildId))
        .join("; ");
      return `${idx + 1}. <@${record.userId}> (${displayName}) - ${games}`;
    });

    const chunks = chunkLines(lines);
    const embeds = chunks.slice(0, 10).map((chunk, idx) =>
      new EmbedBuilder()
        .setTitle(idx === 0 ? "Now Playing - Everyone" : "Now Playing (continued)")
        .setDescription(chunk),
    );

    const truncated = chunks.length > embeds.length;

    await safeReply(interaction, {
      content: truncated
        ? "Showing the first set of results (truncated to Discord embed limits)."
        : undefined,
      embeds,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }
}
