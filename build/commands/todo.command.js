var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, AttachmentBuilder, EmbedBuilder, MessageFlags, } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { readFileSync } from "fs";
import path from "path";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import { completeTodo, createTodo, deleteTodo, listTodos, updateTodo, } from "../classes/Todo.js";
const MAX_LIST_ITEMS = 100;
const MAX_TODO_DESCRIPTION = 3800;
const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(process.cwd(), "src", "assets", "images", GAME_DB_THUMB_NAME);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);
function buildGameDbThumbAttachment() {
    return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}
function applyGameDbThumbnail(embed) {
    return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}
function formatDate(value) {
    if (!value)
        return "n/a";
    return value.toISOString().split("T")[0] ?? "n/a";
}
function formatTodoLines(items) {
    const lines = [];
    for (const item of items) {
        const status = item.isCompleted ? "Completed" : "Open";
        lines.push(`- **#${item.todoId}** ${item.title} (${status})`);
        if (item.details) {
            lines.push(`> ${item.details}`);
        }
        if (item.isCompleted) {
            lines.push(`> Completed: ${formatDate(item.completedAt)}`);
        }
    }
    return lines;
}
function buildTodoDescription(items, includeCompleted) {
    if (items.length === 0) {
        return includeCompleted ? "No TODO items found." : "No open TODO items found.";
    }
    const lines = formatTodoLines(items);
    const trimmedLines = [];
    let currentLength = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const nextLength = currentLength + line.length + 1;
        if (nextLength > MAX_TODO_DESCRIPTION) {
            const remaining = lines.length - i;
            trimmedLines.push(`...and ${remaining} more`);
            break;
        }
        trimmedLines.push(line);
        currentLength = nextLength;
    }
    return trimmedLines.join("\n");
}
function buildTodoListEmbed(items, includeCompleted) {
    const description = buildTodoDescription(items, includeCompleted);
    const openCount = items.filter((item) => !item.isCompleted).length;
    const completedCount = items.filter((item) => item.isCompleted).length;
    const title = includeCompleted ? "Bot TODOs" : "Open Bot TODOs";
    const footerText = `${openCount} open | ${completedCount} completed`;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setFooter({ text: footerText });
    applyGameDbThumbnail(embed);
    const files = [buildGameDbThumbAttachment()];
    return { embeds: [embed], files };
}
let TodoCommand = class TodoCommand {
    async list(includeCompleted, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const todos = await listTodos(Boolean(includeCompleted), MAX_LIST_ITEMS);
        const response = buildTodoListEmbed(todos, Boolean(includeCompleted));
        await safeReply(interaction, {
            ...response,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async add(title, details, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            await safeReply(interaction, {
                content: "Title cannot be empty.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedDetails = details?.trim();
        const todo = await createTodo(trimmedTitle, trimmedDetails ?? null, interaction.user.id);
        await safeReply(interaction, {
            content: `Added TODO #${todo.todoId}: ${todo.title}`,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async edit(todoId, title, details, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        if (title === undefined && details === undefined) {
            await safeReply(interaction, {
                content: "Provide a title or details to update.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedTitle = title?.trim();
        if (title !== undefined && !trimmedTitle) {
            await safeReply(interaction, {
                content: "Title cannot be empty when provided.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedDetails = details === undefined ? undefined : details.trim();
        const finalDetails = trimmedDetails === "" ? null : trimmedDetails;
        const updated = await updateTodo(todoId, trimmedTitle, finalDetails);
        await safeReply(interaction, {
            content: updated ? `Updated TODO #${todoId}.` : `TODO #${todoId} was not found.`,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async delete(todoId, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const removed = await deleteTodo(todoId);
        await safeReply(interaction, {
            content: removed ? `Deleted TODO #${todoId}.` : `TODO #${todoId} was not found.`,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async complete(todoId, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const completed = await completeTodo(todoId, interaction.user.id);
        await safeReply(interaction, {
            content: completed
                ? `Marked TODO #${todoId} as completed.`
                : `TODO #${todoId} was not found or already completed.`,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
};
__decorate([
    Slash({ description: "List bot development TODOs", name: "list" }),
    __param(0, SlashOption({
        description: "Include completed TODOs",
        name: "include_completed",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(1, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "list", null);
__decorate([
    Slash({ description: "Add a bot development TODO", name: "add" }),
    __param(0, SlashOption({
        description: "Short TODO title",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "Optional details for the TODO",
        name: "details",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "add", null);
__decorate([
    Slash({ description: "Edit an existing bot development TODO", name: "edit" }),
    __param(0, SlashOption({
        description: "TODO id",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "New title (optional)",
        name: "title",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "New details (optional, empty clears)",
        name: "details",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "edit", null);
__decorate([
    Slash({ description: "Delete a bot development TODO", name: "delete" }),
    __param(0, SlashOption({
        description: "TODO id",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "delete", null);
__decorate([
    Slash({ description: "Mark a bot development TODO as completed", name: "complete" }),
    __param(0, SlashOption({
        description: "TODO id",
        name: "id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "complete", null);
TodoCommand = __decorate([
    Discord(),
    SlashGroup({ description: "Bot development TODOs (owner manages)", name: "todo" }),
    SlashGroup("todo")
], TodoCommand);
export { TodoCommand };
