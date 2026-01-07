var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashChoice, SlashGroup, SlashOption, } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import { completeTodo, createTodo, countTodos, deleteTodo, fetchTodoById, listTodos, updateTodo, } from "../classes/Todo.js";
import { deleteSuggestion, getSuggestionById, listSuggestions, } from "../classes/Suggestion.js";
const MAX_LIST_ITEMS = 100;
const MAX_TODO_DESCRIPTION = 3800;
const MAX_SUGGESTION_OPTIONS = 25;
const DEFAULT_TODO_CATEGORY = "Improvements";
const TODO_CATEGORIES = ["New Features", "Improvements", "Defects"];
function formatTodoLines(items) {
    const lines = [];
    const labelLengths = items.map((item) => `[${item.todoId}]`.length);
    const maxLabelLength = labelLengths.length
        ? Math.max(...labelLengths)
        : 0;
    for (const item of items) {
        const statusSuffix = item.isCompleted ? " (Completed)" : "";
        const labelRaw = `[${item.todoId}]`;
        const labelPadded = labelRaw.padStart(maxLabelLength, " ");
        const labelBlock = `\`${labelPadded}\``;
        lines.push(`**${labelBlock}** ${item.title}${statusSuffix}`);
        if (item.todoCategory) {
            lines.push(`> Category: ${item.todoCategory}`);
        }
        if (item.details) {
            lines.push(`> ${item.details}`);
        }
    }
    return lines;
}
function buildTodoActionEmbed(action, todo) {
    const title = `${action} TODO #${todo.todoId}`;
    const description = formatTodoLines([todo]).join("\n");
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(description);
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
function buildTodoListEmbed(items, includeCompleted, counts) {
    const description = buildTodoDescription(items, includeCompleted);
    const title = includeCompleted ? "Bot Development TODOs" : "Open Bot Development TODOs";
    const footerText = `${counts.open} open | ${counts.completed} completed`;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(description)
        .setFooter({ text: footerText });
    return { embeds: [embed] };
}
function formatSuggestionLine(item) {
    const title = item.title;
    return `- **#${item.suggestionId}** ${title}`;
}
function buildSuggestionListEmbed(items) {
    if (items.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setTitle("Suggestions")
            .setDescription("No suggestions found.");
        return { embeds: [emptyEmbed] };
    }
    const lines = items.map((item) => formatSuggestionLine(item));
    const description = lines.join("\n");
    const embed = new EmbedBuilder()
        .setTitle("Suggestions")
        .setDescription(description)
        .setFooter({ text: `${items.length} suggestion(s)` });
    return { embeds: [embed] };
}
function buildSuggestionDetailEmbed(item) {
    const createdBy = item.createdBy ? `<@${item.createdBy}>` : "Unknown";
    const createdAt = item.createdAt.toISOString().split("T")[0] ?? "n/a";
    const embed = new EmbedBuilder()
        .setTitle(`Suggestion #${item.suggestionId}`)
        .setDescription(item.title)
        .addFields({ name: "Submitted By", value: createdBy, inline: true }, { name: "Submitted", value: createdAt, inline: true });
    if (item.details) {
        embed.addFields({ name: "Details", value: item.details });
    }
    return embed;
}
let TodoCommand = class TodoCommand {
    async list(todoId, includeCompleted, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const counts = await countTodos();
        if (todoId !== undefined) {
            const todo = await fetchTodoById(todoId);
            if (!todo) {
                await safeReply(interaction, {
                    content: `TODO #${todoId} was not found.`,
                    flags: isPublic ? undefined : MessageFlags.Ephemeral,
                });
                return;
            }
            const response = buildTodoListEmbed([todo], true, counts);
            await safeReply(interaction, {
                ...response,
                flags: isPublic ? undefined : MessageFlags.Ephemeral,
            });
            return;
        }
        const todos = await listTodos(Boolean(includeCompleted), MAX_LIST_ITEMS);
        const response = buildTodoListEmbed(todos, Boolean(includeCompleted), counts);
        await safeReply(interaction, {
            ...response,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async reviewSuggestions(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
        const response = buildSuggestionListEmbed(suggestions);
        if (!suggestions.length) {
            await safeReply(interaction, {
                ...response,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const select = new StringSelectMenuBuilder()
            .setCustomId(`todo-suggestion-select:${interaction.user.id}`)
            .setPlaceholder("Select a suggestion to review")
            .addOptions(suggestions.map((item) => ({
            label: item.title.slice(0, 100),
            value: String(item.suggestionId),
            description: item.details ? item.details.slice(0, 95) : "No details",
        })));
        await safeReply(interaction, {
            ...response,
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleSuggestionSelect(interaction) {
        const [, ownerId] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This review prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const suggestionId = Number(interaction.values?.[0]);
        if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
            await interaction.reply({
                content: "Invalid selection.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const suggestion = await getSuggestionById(suggestionId);
        if (!suggestion) {
            await interaction.reply({
                content: "That suggestion no longer exists.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const embed = buildSuggestionDetailEmbed(suggestion);
        const buttons = new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`todo-suggestion-accept:${ownerId}:${suggestionId}`)
            .setLabel("Accept (Create TODO)")
            .setStyle(ButtonStyle.Success), new ButtonBuilder()
            .setCustomId(`todo-suggestion-decline:${ownerId}:${suggestionId}`)
            .setLabel("Decline (Delete)")
            .setStyle(ButtonStyle.Danger));
        await interaction.update({
            embeds: [embed],
            components: [buttons],
        });
    }
    async handleSuggestionAccept(interaction) {
        const [, ownerId, suggestionIdRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This review prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const suggestionId = Number(suggestionIdRaw);
        if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
            await interaction.reply({
                content: "Invalid suggestion id.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const suggestion = await getSuggestionById(suggestionId);
        if (!suggestion) {
            await interaction.reply({
                content: "That suggestion no longer exists.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const todo = await createTodo(suggestion.title, suggestion.details ?? null, DEFAULT_TODO_CATEGORY, suggestion.createdBy);
        await deleteSuggestion(suggestionId);
        await interaction.update({
            content: `Accepted suggestion #${suggestionId} and created TODO #${todo.todoId}.`,
            embeds: [],
            components: [],
            files: [],
        });
    }
    async handleSuggestionDecline(interaction) {
        const [, ownerId, suggestionIdRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This review prompt isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const suggestionId = Number(suggestionIdRaw);
        if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
            await interaction.reply({
                content: "Invalid suggestion id.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const deleted = await deleteSuggestion(suggestionId);
        await interaction.update({
            content: deleted
                ? `Declined suggestion #${suggestionId}.`
                : "That suggestion no longer exists.",
            embeds: [],
            components: [],
            files: [],
        });
    }
    async add(title, category, details, showInChat, interaction) {
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
        const todo = await createTodo(trimmedTitle, trimmedDetails ?? null, category, interaction.user.id);
        await safeReply(interaction, {
            embeds: [buildTodoActionEmbed("Added", todo)],
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async edit(todoId, title, details, category, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        if (title === undefined && details === undefined && category === undefined) {
            await safeReply(interaction, {
                content: "Provide a title, details, or category to update.",
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
        const updated = await updateTodo(todoId, trimmedTitle, finalDetails, category);
        const updatedTodo = updated ? await fetchTodoById(todoId) : null;
        await safeReply(interaction, {
            content: updatedTodo
                ? undefined
                : updated
                    ? `Updated TODO #${todoId}.`
                    : `TODO #${todoId} was not found.`,
            embeds: updatedTodo ? [buildTodoActionEmbed("Updated", updatedTodo)] : undefined,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async delete(todoId, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const existing = await fetchTodoById(todoId);
        const removed = await deleteTodo(todoId);
        await safeReply(interaction, {
            content: removed
                ? existing
                    ? undefined
                    : `Deleted TODO #${todoId}.`
                : `TODO #${todoId} was not found.`,
            embeds: removed && existing ? [buildTodoActionEmbed("Deleted", existing)] : undefined,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
    async complete(todoId, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const existing = await fetchTodoById(todoId);
        const completed = await completeTodo(todoId, interaction.user.id);
        await safeReply(interaction, {
            content: completed
                ? existing
                    ? undefined
                    : `Marked TODO #${todoId} as completed.`
                : `TODO #${todoId} was not found or already completed.`,
            embeds: completed && existing
                ? [buildTodoActionEmbed("Completed", existing)]
                : undefined,
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
    }
};
__decorate([
    Slash({ description: "List bot development TODOs", name: "list" }),
    __param(0, SlashOption({
        description: "TODO id to view details (optional)",
        name: "id",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    })),
    __param(1, SlashOption({
        description: "Include completed TODOs",
        name: "include_completed",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    })),
    __param(2, SlashOption({
        description: "Show in chat (public) instead of ephemeral",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], TodoCommand.prototype, "list", null);
__decorate([
    Slash({ description: "Review user suggestions", name: "review-suggestions" })
], TodoCommand.prototype, "reviewSuggestions", null);
__decorate([
    SelectMenuComponent({ id: /^todo-suggestion-select:\d+$/ })
], TodoCommand.prototype, "handleSuggestionSelect", null);
__decorate([
    ButtonComponent({ id: /^todo-suggestion-accept:\d+:\d+$/ })
], TodoCommand.prototype, "handleSuggestionAccept", null);
__decorate([
    ButtonComponent({ id: /^todo-suggestion-decline:\d+:\d+$/ })
], TodoCommand.prototype, "handleSuggestionDecline", null);
__decorate([
    Slash({ description: "Add a bot development TODO", name: "add" }),
    __param(0, SlashOption({
        description: "Short TODO title",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashChoice(...TODO_CATEGORIES)),
    __param(1, SlashOption({
        description: "TODO category",
        name: "category",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Optional details for the TODO",
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
    __param(3, SlashChoice(...TODO_CATEGORIES)),
    __param(3, SlashOption({
        description: "New category (optional)",
        name: "category",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
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
