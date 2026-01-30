import { EmbedBuilder } from "discord.js";
import type { Message, MessageReaction, PartialMessageReaction } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import Starboard from "../classes/Starboard.js";
import { formatTimestampWithDay } from "../utilities/DiscordLogUtils.js";
import { QUOTABLES_CHANNEL_ID } from "../config/channels.js";

const STAR_EMOJI = "⭐";
const STAR_EMOJI_NAME = "star";
const STAR_THRESHOLD = 3;

function isStarReaction(reaction: MessageReaction | PartialMessageReaction): boolean {
  const name = reaction.emoji?.name;
  return name === STAR_EMOJI || name === STAR_EMOJI_NAME;
}

function getMessageContent(message: Message): string {
  const content = message.cleanContent?.trim() ?? message.content?.trim() ?? "";
  if (content) return content;
  if (message.attachments.size > 0) {
    return "Attachment";
  }
  return "No text content.";
}

function getImageUrl(message: Message): string | null {
  const attachment = [...message.attachments.values()].find((file) => {
    if (file.contentType?.startsWith("image/")) return true;
    return Boolean(file.url?.match(/\.(png|jpe?g|gif|webp)$/i));
  });
  if (attachment) return attachment.url;
  const embedImage = message.embeds.find((embed) => embed.image?.url)?.image?.url;
  return embedImage ?? null;
}

async function resolveQuotablesChannel(client: Client): Promise<any | null> {
  const channel = await client.channels.fetch(QUOTABLES_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  const sendable = channel as any;
  return typeof sendable.send === "function" ? sendable : null;
}

@Discord()
export class StarboardHandler {
  @On()
  async messageReactionAdd(
    [reaction, user]: ArgsOf<"messageReactionAdd">,
    client: Client,
  ): Promise<void> {
    if (user.bot) return;

    if (reaction.partial) {
      await reaction.fetch().catch(() => {});
    }
    const message = reaction.message?.partial
      ? await reaction.message.fetch().catch(() => null)
      : reaction.message;
    if (!message || !message.guild) return;
    if (!isStarReaction(reaction)) return;
    if (message.channelId === QUOTABLES_CHANNEL_ID) return;
    if (!message.author || message.author.bot) return;

    const count = reaction.count ?? 0;
    if (count < STAR_THRESHOLD) return;

    const existing = await Starboard.getByMessageId(message.id);
    if (existing) return;

    const quotablesChannel = await resolveQuotablesChannel(client);
    if (!quotablesChannel) return;

    const content = getMessageContent(message);
    const imageUrl = getImageUrl(message);
    const channelName = (message.channel as { name?: string } | null)?.name ?? "channel";
    const channelLabel = `#${channelName}`;
    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.globalName ?? message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setDescription(content)
      .addFields({ name: "Source", value: `[${channelLabel}](${message.url})` })
      .setFooter({
        text: `${message.id} • ${formatTimestampWithDay(message.createdTimestamp)}`,
      })
      .setColor(0x2f3136);

    if (imageUrl) {
      embed.setImage(imageUrl);
    }

    const posted = await quotablesChannel.send({ embeds: [embed] });
    await Starboard.insert({
      messageId: message.id,
      channelId: message.channelId,
      starboardMessageId: posted.id,
      authorId: message.author.id,
      starCount: count,
    });
  }
}
