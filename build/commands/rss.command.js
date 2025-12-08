var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isAdmin } from "./admin.command.js";
import { addFeed, listFeeds, removeFeed, updateFeed } from "../classes/RssFeed.js";
import { buildRssHelpResponse } from "./help.command.js";
function normalizeList(value) {
    if (!value)
        return [];
    return value
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
}
let RssCommand = class RssCommand {
    async help(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        const response = buildRssHelpResponse();
        await safeReply(interaction, { ...response, ephemeral: true });
    }
    async add(url, channel, feedName, include, exclude, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        try {
            const includeKeywords = normalizeList(include);
            const excludeKeywords = normalizeList(exclude);
            const channelId = channel.id;
            const id = await addFeed(feedName ?? null, url, channelId, includeKeywords, excludeKeywords);
            await safeReply(interaction, {
                content: `Added feed #${id} (${feedName ?? "unnamed"}) -> <#${channelId}> (url=${url}).`,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to add feed: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async remove(feedId, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        try {
            const removed = await removeFeed(feedId);
            await safeReply(interaction, {
                content: removed ? `Removed feed #${feedId}.` : `Feed #${feedId} not found.`,
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to remove feed: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async edit(feedId, url, feedName, channel, include, exclude, interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        if (url === undefined &&
            feedName === undefined &&
            channel === undefined &&
            include === undefined &&
            exclude === undefined) {
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
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to edit feed: ${msg}`,
                ephemeral: true,
            });
        }
    }
    async list(interaction) {
        await safeDeferReply(interaction, { ephemeral: true });
        const ok = await isAdmin(interaction);
        if (!ok)
            return;
        try {
            const feeds = await listFeeds();
            if (!feeds.length) {
                await safeReply(interaction, { content: "No feeds configured.", ephemeral: true });
                return;
            }
            const lines = feeds.map((f) => `#${f.feedId}: ${f.feedName ?? "(no name)"} ${f.feedUrl} -> <#${f.channelId}>` +
                (f.includeKeywords.length ? ` include=[${f.includeKeywords.join(", ")}]` : "") +
                (f.excludeKeywords.length ? ` exclude=[${f.excludeKeywords.join(", ")}]` : ""));
            await safeReply(interaction, {
                content: lines.join("\n"),
                ephemeral: true,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Failed to list feeds: ${msg}`,
                ephemeral: true,
            });
        }
    }
};
__decorate([
    Slash({ description: "Show help for RSS commands", name: "help" })
], RssCommand.prototype, "help", null);
__decorate([
    Slash({ description: "Add an RSS feed relay", name: "add" }),
    __param(0, SlashOption({
        description: "RSS feed URL",
        name: "url",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "Channel to post URLs into",
        name: "channel",
        required: true,
        type: ApplicationCommandOptionType.Channel,
    })),
    __param(2, SlashOption({
        description: "Optional friendly name",
        name: "name",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Comma-separated include keywords (optional)",
        name: "include",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
        description: "Comma-separated exclude keywords (optional)",
        name: "exclude",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], RssCommand.prototype, "add", null);
__decorate([
    Slash({ description: "Remove an RSS feed relay", name: "remove" }),
    __param(0, SlashOption({
        description: "Feed id (see /rss list)",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], RssCommand.prototype, "remove", null);
__decorate([
    Slash({ description: "Edit an RSS feed relay", name: "edit" }),
    __param(0, SlashOption({
        description: "Feed id (see /rss list)",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "New RSS feed URL (optional)",
        name: "url",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "New friendly name (optional)",
        name: "name",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "New channel to post URLs into (optional)",
        name: "channel",
        required: false,
        type: ApplicationCommandOptionType.Channel,
    })),
    __param(4, SlashOption({
        description: "Comma-separated include keywords (optional)",
        name: "include",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(5, SlashOption({
        description: "Comma-separated exclude keywords (optional)",
        name: "exclude",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], RssCommand.prototype, "edit", null);
__decorate([
    Slash({ description: "List RSS feed relays", name: "list" })
], RssCommand.prototype, "list", null);
RssCommand = __decorate([
    Discord(),
    SlashGroup({ description: "Manage RSS feed relays", name: "rss" }),
    SlashGroup("rss")
], RssCommand);
export { RssCommand };
