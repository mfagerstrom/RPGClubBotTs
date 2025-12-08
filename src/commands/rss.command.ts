import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, type Channel } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import { addFeed, listFeeds, removeFeed, updateFeed } from "../classes/RssFeed.js";

function normalizeList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

@Discord()
@SlashGroup({ description: "Manage RSS feed relays", name: "rss" })
@SlashGroup("rss")
export class RssCommand {
  @Slash({ description: "Add an RSS feed relay", name: "add" })
  async add(
    @SlashOption({
      description: "RSS feed URL",
      name: "url",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    url: string,
    @SlashOption({
      description: "Channel to post URLs into",
      name: "channel",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel,
    @SlashOption({
      description: "Optional friendly name",
      name: "name",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    feedName: string | undefined,
    @SlashOption({
      description: "Comma-separated include keywords (optional)",
      name: "include",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    include: string | undefined,
    @SlashOption({
      description: "Comma-separated exclude keywords (optional)",
      name: "exclude",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    exclude: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const includeKeywords = normalizeList(include);
      const excludeKeywords = normalizeList(exclude);
      const channelId = channel.id;
      const id = await addFeed(feedName ?? null, url, channelId, includeKeywords, excludeKeywords);
      await safeReply(interaction, {
        content: `Added feed #${id} (${feedName ?? "unnamed"}) -> <#${channelId}> (url=${url}).`,
        ephemeral: true,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to add feed: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({ description: "Remove an RSS feed relay", name: "remove" })
  async remove(
    @SlashOption({
      description: "Feed id (see /rss list)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    feedId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const removed = await removeFeed(feedId);
      await safeReply(interaction, {
        content: removed ? `Removed feed #${feedId}.` : `Feed #${feedId} not found.`,
        ephemeral: true,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to remove feed: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({ description: "Edit an RSS feed relay", name: "edit" })
  async edit(
    @SlashOption({
      description: "Feed id (see /rss list)",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    feedId: number,
    @SlashOption({
      description: "New RSS feed URL (optional)",
      name: "url",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    url: string | undefined,
    @SlashOption({
      description: "New friendly name (optional)",
      name: "name",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    feedName: string | undefined,
    @SlashOption({
      description: "New channel to post URLs into (optional)",
      name: "channel",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    channel: Channel | undefined,
    @SlashOption({
      description: "Comma-separated include keywords (optional)",
      name: "include",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    include: string | undefined,
    @SlashOption({
      description: "Comma-separated exclude keywords (optional)",
      name: "exclude",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    exclude: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    if (
      url === undefined &&
      feedName === undefined &&
      channel === undefined &&
      include === undefined &&
      exclude === undefined
    ) {
      await safeReply(interaction, {
        content: "Nothing to update. Provide at least one field (url/channel/include/exclude).",
        ephemeral: true,
      });
      return;
    }

    try {
      const includeKeywords = include === undefined ? undefined : normalizeList(include);
      const excludeKeywords = exclude === undefined ? undefined : normalizeList(exclude);
      const channelId = channel ? channel.id : undefined;
      const updated = await updateFeed(feedId, {
        feedUrl: url,
        channelId: channelId,
        includeKeywords,
        excludeKeywords,
        feedName: feedName ?? undefined,
      });

      await safeReply(interaction, {
        content: updated
          ? `Updated feed #${feedId}.`
          : `Feed #${feedId} not found or no changes applied.`,
        ephemeral: true,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to edit feed: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({ description: "List RSS feed relays", name: "list" })
  async list(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const ok = await isAdmin(interaction);
    if (!ok) return;

    try {
      const feeds = await listFeeds();
      if (!feeds.length) {
        await safeReply(interaction, { content: "No feeds configured.", ephemeral: true });
        return;
      }

      const lines = feeds.map(
        (f) =>
          `#${f.feedId}: ${f.feedName ?? "(no name)"} ${f.feedUrl} -> <#${f.channelId}>` +
          (f.includeKeywords.length ? ` include=[${f.includeKeywords.join(", ")}]` : "") +
          (f.excludeKeywords.length ? ` exclude=[${f.excludeKeywords.join(", ")}]` : ""),
      );

      await safeReply(interaction, {
        content: lines.join("\n"),
        ephemeral: true,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to list feeds: ${msg}`,
        ephemeral: true,
      });
    }
  }
}
