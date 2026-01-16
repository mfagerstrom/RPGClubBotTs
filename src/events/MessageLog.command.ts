import { EmbedBuilder } from "discord.js";
import type { Message } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
const MAX_FIELD_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 3500;

function truncate(text: string, maxLength = MAX_FIELD_LENGTH): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function formatMessageContent(message: Message): string {
  const content = message.cleanContent?.trim() ?? message.content?.trim() ?? "";
  if (content) return content;
  if (message.attachments.size) {
    const urls = [...message.attachments.values()].map((attachment) => attachment.url);
    return urls.length ? `Attachments:\n${urls.join("\n")}` : "Attachments only.";
  }
  return "No text content.";
}

function formatTimestamp(timestamp: number | null | undefined): string {
  const date = new Date(timestamp ?? Date.now());
  return date.toLocaleString("en-US");
}

function buildAuthorEmbed(
  message: Message,
  title: string,
  color: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color);

  if (message.author) {
    const name = message.author.globalName ?? message.author.username;
    embed.setAuthor({
      name,
      iconURL: message.author.displayAvatarURL(),
    });
    embed.setFooter({
      text: `ID: ${message.author.id} • ${formatTimestamp(message.createdTimestamp)}`,
    });
  }

  embed.addFields({ name: "Message ID", value: message.id });
  return embed;
}

@Discord()
export class MessageLog {
  @On()
  async messageDelete([message]: ArgsOf<"messageDelete">, client: Client): Promise<void> {
    const resolved = message.partial ? await message.fetch().catch(() => null) : message;
    if (!resolved || !resolved.author || resolved.author.bot) return;

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const channelMention = `<#${resolved.channelId}>`;
    const embed = buildAuthorEmbed(
      resolved,
      `Message deleted in ${channelMention}`,
      0xe74c3c,
    );
    embed.setDescription(truncate(formatMessageContent(resolved)));

    await logChannel.send({ embeds: [embed] });
  }

  @On()
  async messageUpdate(
    [oldMessage, newMessage]: ArgsOf<"messageUpdate">,
    client: Client,
  ): Promise<void> {
    const resolvedNew = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
    if (!resolvedNew || !resolvedNew.author || resolvedNew.author.bot) return;

    const beforeText = oldMessage.partial ? "" : (oldMessage.cleanContent ?? oldMessage.content ?? "");
    const afterText = resolvedNew.cleanContent ?? resolvedNew.content ?? "";
    if (beforeText.trim() === afterText.trim()) {
      return;
    }

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const jumpUrl = resolvedNew.guildId
      ? `https://discord.com/channels/${resolvedNew.guildId}/${resolvedNew.channelId}/${resolvedNew.id}`
      : null;
    const title = "Message edited";
    const embed = buildAuthorEmbed(
      resolvedNew,
      title,
      0x3498db,
    );
    embed.setFields([]);
    const beforeValue = truncate(beforeText || "No text content.");
    const afterValue = truncate(afterText || "No text content.");
    const linkLine = jumpUrl ? `[Jump to message](${jumpUrl})` : "";
    const description =
      `**Before:** ${beforeValue}\n**+After:** ${afterValue}` +
      (linkLine ? `\n${linkLine}` : "");
    embed.setDescription(truncate(description, MAX_DESCRIPTION_LENGTH));
    embed.setFooter({
      text: `ID: ${resolvedNew.id} • ${formatTimestampWithDay(resolvedNew.editedTimestamp)}`,
    });

    await logChannel.send({ embeds: [embed] });
  }
}
