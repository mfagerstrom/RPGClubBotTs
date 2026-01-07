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
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import { completeTodo, createTodo, countTodoSummary, deleteTodo, fetchTodoById, listTodos, updateTodo, } from "../classes/Todo.js";
import { countSuggestions, deleteSuggestion, getSuggestionById, listSuggestions, } from "../classes/Suggestion.js";
const MAX_LIST_ITEMS = 100;
const MAX_TODO_DESCRIPTION = 3800;
const MAX_SUGGESTION_OPTIONS = 25;
const DEFAULT_TODO_CATEGORY = "Improvements";
const TODO_CATEGORIES = ["New Features", "Improvements", "Defects", "Blocked", "Refactoring"];
const TODO_SIZES = ["XS", "S", "M", "L", "XL"];
const TODO_TAB_DEFINITIONS = [
    { id: "all", label: "All Open" },
    { id: "New Features", label: "New Features" },
    { id: "Improvements", label: "Improvements" },
    { id: "Defects", label: "Defects" },
    { id: "Blocked", label: "Blocked" },
    { id: "Refactoring", label: "Refactoring" },
    { id: "suggestions", label: "Suggestions" },
    { id: "completed", label: "Completed" },
];
const TODO_TAB_OPTIONS = TODO_TAB_DEFINITIONS.map((tab) => tab.label);
const TODO_TAB_LABEL_TO_FILTER = {
    "All Open": "all",
    "New Features": "New Features",
    Improvements: "Improvements",
    Defects: "Defects",
    Blocked: "Blocked",
    Refactoring: "Refactoring",
    Suggestions: "suggestions",
    Completed: "completed",
};
const latestTodoListByChannel = new Map();
const serializeSizeToken = (sizes) => (sizes.length ? sizes.join(",") : "any");
const parseSizeToken = (token) => {
    if (!token || token === "any")
        return [];
    const parts = token.split(",").map((part) => part.trim());
    const valid = parts.filter((part) => TODO_SIZES.includes(part));
    return Array.from(new Set(valid));
};
function buildTodoListComponents(active, ownerId, sizes, items) {
    const sizeToken = serializeSizeToken(sizes);
    const filterOptions = TODO_TAB_DEFINITIONS.map((tab) => ({
        label: tab.label,
        value: tab.id,
        default: tab.id === active,
    }));
    const filterSelect = new StringSelectMenuBuilder()
        .setCustomId(`todo-tab:${active}:${ownerId}:${sizeToken}`)
        .setPlaceholder("Select a view")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(filterOptions);
    const rows = [
        new ActionRowBuilder().addComponents(filterSelect),
    ];
    if (active === "suggestions") {
        return rows;
    }
    const sizeOptions = TODO_SIZES.map((s) => ({
        label: s,
        value: s,
        default: sizes.includes(s),
    }));
    const sizeSelect = new StringSelectMenuBuilder()
        .setCustomId(`todo-size:${active}:${ownerId}:${sizeToken}`)
        .setPlaceholder("Filter by effort estimate")
        .setMinValues(0)
        .setMaxValues(TODO_SIZES.length)
        .addOptions(sizeOptions);
    rows.push(new ActionRowBuilder().addComponents(sizeSelect));
    const scopedItems = active === "all" || active === "completed"
        ? items
        : items.filter((item) => item.todoCategory === active);
    const openItems = scopedItems.filter((item) => !item.isCompleted);
    if (openItems.length) {
        const options = openItems.slice(0, MAX_SUGGESTION_OPTIONS).map((item) => ({
            label: `[#${item.todoId}] ${item.title}`.slice(0, 100),
            value: String(item.todoId),
            description: item.details ? item.details.slice(0, 95) : "Mark completed",
        }));
        const completeSelect = new StringSelectMenuBuilder()
            .setCustomId(`todo-complete:${active}:${ownerId}:${sizeToken}`)
            .setPlaceholder("Mark a TODO as completed")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(options);
        rows.push(new ActionRowBuilder().addComponents(completeSelect));
    }
    return rows;
}
function trackTodoListState(channelId, messageId, filter, ownerId, sizes) {
    if (!channelId || !messageId)
        return;
    latestTodoListByChannel.set(channelId, { messageId, filter, ownerId, sizes });
}
function parseTodoListStateFromMessage(message) {
    const components = message?.components ?? [];
    let activeFilter = null;
    let ownerId = null;
    let sizes = [];
    for (const row of components) {
        const rowComponents = row?.components ?? [];
        for (const component of rowComponents) {
            const customId = component?.customId;
            if (typeof customId !== "string")
                continue;
            if (!customId.startsWith("todo-tab:") && !customId.startsWith("todo-size:")) {
                continue;
            }
            const [, filterRaw, ownerRaw, sizeRaw] = customId.split(":");
            if (!filterRaw || !ownerRaw)
                continue;
            activeFilter = filterRaw;
            ownerId = ownerRaw;
            sizes = parseSizeToken(sizeRaw);
        }
    }
    if (!activeFilter || !ownerId || !message?.id)
        return null;
    return { messageId: message.id, filter: activeFilter, ownerId, sizes };
}
async function findLatestTodoListState(channel) {
    if (!channel?.messages?.fetch)
        return null;
    const messages = await channel.messages.fetch({ limit: 50 });
    for (const message of messages.values()) {
        if (!message?.author?.bot)
            continue;
        const state = parseTodoListStateFromMessage(message);
        if (state)
            return state;
    }
    return null;
}
async function refreshLatestTodoList(channelId, client) {
    if (!channelId)
        return;
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased())
            return;
        let state = latestTodoListByChannel.get(channelId);
        if (!state) {
            const recovered = await findLatestTodoListState(channel);
            if (!recovered)
                return;
            latestTodoListByChannel.set(channelId, recovered);
            state = recovered;
        }
        let message = await channel.messages.fetch(state.messageId).catch(() => null);
        if (!message) {
            const recovered = await findLatestTodoListState(channel);
            if (!recovered) {
                latestTodoListByChannel.delete(channelId);
                return;
            }
            latestTodoListByChannel.set(channelId, recovered);
            state = recovered;
            message = await channel.messages.fetch(state.messageId).catch(() => null);
            if (!message) {
                latestTodoListByChannel.delete(channelId);
                return;
            }
        }
        const summary = await countTodoSummary();
        const suggestionCount = await countSuggestions();
        const footerText = buildAllTodoFooterText(summary, suggestionCount);
        if (state.filter === "suggestions") {
            const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
            const embed = buildSuggestionTabEmbed(suggestions, footerText);
            await message.edit({
                embeds: [embed],
                components: buildTodoListComponents("suggestions", state.ownerId, state.sizes, []),
            });
            return;
        }
        const query = extractTodoQueryFromMessage(message);
        const includeDetails = state.filter !== "all" && state.filter !== "completed";
        const todos = state.filter === "completed"
            ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
            : await listTodos(false, MAX_LIST_ITEMS);
        const filteredTodos = state.sizes.length
            ? todos.filter((item) => item.todoSize && state.sizes.includes(item.todoSize))
            : todos;
        const filteredTodosByQuery = filterTodosByQuery(filteredTodos, query);
        const response = buildTodoListEmbed(filteredTodosByQuery, state.filter === "completed", footerText, state.filter, includeDetails, query);
        await message.edit({
            ...response,
            components: buildTodoListComponents(state.filter, state.ownerId, state.sizes, filteredTodosByQuery),
        });
    }
    catch {
        latestTodoListByChannel.delete(channelId);
    }
}
function formatTodoLines(items, includeDetails) {
    const lines = [];
    const labelLengths = items.map((item) => `[${item.todoId}]`.length);
    const maxLabelLength = labelLengths.length
        ? Math.max(...labelLengths)
        : 0;
    const sizeLabelMap = {
        XS: "[XS]",
        S: "[S]",
        M: "[M]",
        L: "[L]",
        XL: "[XL]",
    };
    for (const item of items) {
        const statusSuffix = item.isCompleted ? " (Completed)" : "";
        const sizeLabel = item.todoSize
            ? (sizeLabelMap[item.todoSize] ?? null)
            : null;
        const sizeSuffix = sizeLabel ? ` ${sizeLabel}` : "";
        const labelRaw = `[${item.todoId}]`;
        const labelPadded = labelRaw.padStart(maxLabelLength, " ");
        const labelBlock = `\`${labelPadded}\``;
        lines.push(`**${labelBlock}** ${item.title}${statusSuffix}${sizeSuffix}`);
        if (includeDetails && item.details) {
            lines.push(`> ${item.details}`);
        }
    }
    return lines;
}
function buildCategoryTodoLines(items, category, includeDetails) {
    const categoryItems = items.filter((item) => item.todoCategory === category);
    if (!categoryItems.length)
        return [];
    return [`**${category}**`, ...formatTodoLines(categoryItems, includeDetails), ""];
}
function buildSuggestionLines(items) {
    if (!items.length)
        return ["No suggestions found."];
    const lines = [];
    for (const item of items) {
        lines.push(`**[#${item.suggestionId}]** ${item.title}`);
        if (item.details) {
            lines.push(`> ${item.details}`);
        }
    }
    return lines;
}
function buildSuggestionTabEmbed(items, footerText) {
    return new EmbedBuilder()
        .setTitle("Suggestions")
        .setColor(0x3498db)
        .setDescription(buildSuggestionLines(items).join("\n"))
        .setFooter({ text: footerText });
}
function buildTodoActionEmbed(action, todo) {
    const title = `${action} TODO #${todo.todoId} (${todo.todoCategory})`;
    const line = formatTodoLines([todo], false).join("\n");
    const description = todo.details ? `${line}\n> ${todo.details}` : line;
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(description);
}
function buildAllTodoFooterText(summary, suggestionCount) {
    return [
        `${summary.open} open TODOs`,
        `${summary.openByCategory.newFeatures} New Features`,
        `${summary.openByCategory.improvements} Improvements`,
        `${summary.openByCategory.defects} Defects`,
        `${summary.openByCategory.blocked} Blocked`,
        `${summary.openByCategory.refactoring} Refactoring`,
        `${suggestionCount} Suggestions`,
        `${summary.completed} Completed`,
    ].join(" | ");
}
function buildTodoDescription(items, includeCompleted, filter, includeDetails) {
    if (items.length === 0) {
        return includeCompleted ? "No TODO items found." : "No open TODO items found.";
    }
    const lines = [];
    if (filter === "all" || filter === "completed") {
        for (const category of TODO_CATEGORIES) {
            lines.push(...buildCategoryTodoLines(items, category, includeDetails));
        }
    }
    else if (filter !== "suggestions") {
        lines.push(...buildCategoryTodoLines(items, filter, includeDetails));
    }
    if (lines.length === 0) {
        return includeCompleted ? "No TODO items found." : "No open TODO items found.";
    }
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
    while (trimmedLines.length && trimmedLines[trimmedLines.length - 1] === "") {
        trimmedLines.pop();
    }
    return trimmedLines.join("\n");
}
function normalizeTodoQuery(query) {
    return (query ?? "").trim().toLowerCase();
}
function filterTodosByQuery(items, query) {
    const trimmedQuery = normalizeTodoQuery(query);
    if (!trimmedQuery)
        return items;
    return items.filter((item) => {
        const title = item.title.toLowerCase();
        const details = item.details?.toLowerCase() ?? "";
        return title.includes(trimmedQuery) || details.includes(trimmedQuery);
    });
}
function extractTodoQueryFromMessage(message) {
    const description = message?.embeds?.[0]?.description;
    if (typeof description !== "string")
        return null;
    const match = description.match(/^Query:\s*(.+?)(?:\n|$)/);
    if (!match)
        return null;
    const trimmedQuery = normalizeTodoQuery(match[1]);
    return trimmedQuery ? trimmedQuery : null;
}
function buildTodoListEmbed(items, includeCompleted, footerText, filter, includeDetails, query) {
    const description = buildTodoDescription(items, includeCompleted, filter, includeDetails);
    const title = "Bot Development TODOs";
    const queryLine = query ? `Query: ${query}\n` : "";
    const fullDescription = queryLine
        ? `${queryLine}\n${description}`
        : description;
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0x3498db)
        .setDescription(fullDescription)
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
    async list(mode, size, query, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        if (size && !TODO_SIZES.includes(size)) {
            await safeReply(interaction, {
                content: "Invalid size. Use XS, S, M, L, or XL.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const summary = await countTodoSummary();
        const suggestionCount = await countSuggestions();
        const filter = mode ? TODO_TAB_LABEL_TO_FILTER[mode] : "all";
        const footerText = buildAllTodoFooterText(summary, suggestionCount);
        if (filter === "suggestions") {
            const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
            const embed = buildSuggestionTabEmbed(suggestions, footerText);
            const reply = await safeReply(interaction, {
                embeds: [embed],
                components: buildTodoListComponents("suggestions", interaction.user.id, size ? [size] : [], []),
                flags: isPublic ? undefined : MessageFlags.Ephemeral,
            });
            if (isPublic) {
                const replyMessage = reply ?? await interaction.fetchReply();
                trackTodoListState(interaction.channelId, replyMessage?.id, "suggestions", interaction.user.id, size ? [size] : []);
            }
            return;
        }
        const includeDetails = filter !== "all" && filter !== "completed";
        const todos = filter === "completed"
            ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
            : await listTodos(false, MAX_LIST_ITEMS);
        const filteredTodosBySize = size
            ? todos.filter((item) => item.todoSize === size)
            : todos;
        const trimmedQuery = normalizeTodoQuery(query);
        const filteredTodos = filterTodosByQuery(filteredTodosBySize, trimmedQuery);
        const response = buildTodoListEmbed(filteredTodos, filter === "completed", footerText, filter, includeDetails, trimmedQuery || null);
        const reply = await safeReply(interaction, {
            ...response,
            components: buildTodoListComponents(filter, interaction.user.id, size ? [size] : [], filteredTodos),
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
        if (isPublic) {
            const replyMessage = reply ?? await interaction.fetchReply();
            trackTodoListState(interaction.channelId, replyMessage?.id, filter, interaction.user.id, size ? [size] : []);
        }
    }
    async reviewSuggestions(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        await this.renderSuggestionMenu(interaction);
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
        const todo = await createTodo(suggestion.title, suggestion.details ?? null, DEFAULT_TODO_CATEGORY, null, suggestion.createdBy);
        await deleteSuggestion(suggestionId);
        await this.renderSuggestionMenu(interaction, {
            content: `Accepted suggestion #${suggestionId} and created TODO #${todo.todoId}.`,
        });
        await refreshLatestTodoList(interaction.channelId, interaction.client);
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
        await this.renderSuggestionMenu(interaction, {
            content: deleted
                ? `Declined suggestion #${suggestionId}.`
                : "That suggestion no longer exists.",
        });
    }
    async renderSuggestionMenu(interaction, payload) {
        const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
        const response = buildSuggestionListEmbed(suggestions);
        if (!suggestions.length) {
            await safeUpdate(interaction, {
                ...response,
                content: payload?.content ?? "No suggestions found.",
                components: [],
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
        await safeUpdate(interaction, {
            ...response,
            content: payload?.content ?? undefined,
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral,
        });
    }
    async add(title, category, size, details, showInChat, interaction) {
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
        if (size && !TODO_SIZES.includes(size)) {
            await safeReply(interaction, {
                content: "Invalid size. Use XS, S, M, L, or XL.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedDetails = details?.trim();
        const finalSize = size;
        const todo = await createTodo(trimmedTitle, trimmedDetails ?? null, category, finalSize, interaction.user.id);
        await safeReply(interaction, {
            embeds: [buildTodoActionEmbed("Added", todo)],
            flags: isPublic ? undefined : MessageFlags.Ephemeral,
        });
        await refreshLatestTodoList(interaction.channelId, interaction.client);
    }
    async edit(todoId, title, details, category, size, showInChat, interaction) {
        const isPublic = Boolean(showInChat);
        await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        if (title === undefined && details === undefined && category === undefined && size === undefined) {
            await safeReply(interaction, {
                content: "Provide a title, details, category, or size to update.",
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
        if (size && !TODO_SIZES.includes(size)) {
            await safeReply(interaction, {
                content: "Invalid size. Use XS, S, M, L, or XL.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedDetails = details === undefined ? undefined : details.trim();
        const finalDetails = trimmedDetails === "" ? null : trimmedDetails;
        const updated = await updateTodo(todoId, trimmedTitle, finalDetails, category, size);
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
        if (updated) {
            await refreshLatestTodoList(interaction.channelId, interaction.client);
        }
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
        if (removed) {
            await refreshLatestTodoList(interaction.channelId, interaction.client);
        }
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
        if (completed) {
            await refreshLatestTodoList(interaction.channelId, interaction.client);
        }
    }
    async handleTodoTab(interaction) {
        const [, , ownerId, sizeRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const selectedFilter = interaction.values?.[0];
        if (!selectedFilter) {
            await interaction.reply({
                content: "No filter selected.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const sizes = parseSizeToken(sizeRaw);
        const query = extractTodoQueryFromMessage(interaction.message);
        const summary = await countTodoSummary();
        const suggestionCount = await countSuggestions();
        const footerText = buildAllTodoFooterText(summary, suggestionCount);
        if (selectedFilter === "suggestions") {
            const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
            const embed = buildSuggestionTabEmbed(suggestions, footerText);
            await safeUpdate(interaction, {
                embeds: [embed],
                components: buildTodoListComponents("suggestions", ownerId, sizes, []),
            });
            trackTodoListState(interaction.channelId, interaction.message?.id, "suggestions", ownerId, sizes);
            return;
        }
        const includeDetails = selectedFilter !== "all" && selectedFilter !== "completed";
        const todos = selectedFilter === "completed"
            ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
            : await listTodos(false, MAX_LIST_ITEMS);
        const filteredTodos = sizes.length
            ? todos.filter((item) => item.todoSize && sizes.includes(item.todoSize))
            : todos;
        const filteredTodosByQuery = filterTodosByQuery(filteredTodos, query);
        const response = buildTodoListEmbed(filteredTodosByQuery, selectedFilter === "completed", footerText, selectedFilter, includeDetails, query);
        await safeUpdate(interaction, {
            ...response,
            components: buildTodoListComponents(selectedFilter, ownerId, sizes, filteredTodosByQuery),
        });
        trackTodoListState(interaction.channelId, interaction.message?.id, selectedFilter, ownerId, sizes);
    }
    async handleTodoSize(interaction) {
        const [, filterRaw, ownerId] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const selectedValues = interaction.values ?? [];
        const sizes = Array.from(new Set(selectedValues.filter((value) => TODO_SIZES.includes(value))));
        const filter = filterRaw;
        const query = extractTodoQueryFromMessage(interaction.message);
        const summary = await countTodoSummary();
        const suggestionCount = await countSuggestions();
        const footerText = buildAllTodoFooterText(summary, suggestionCount);
        if (filter === "suggestions") {
            const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
            const embed = buildSuggestionTabEmbed(suggestions, footerText);
            await safeUpdate(interaction, {
                embeds: [embed],
                components: buildTodoListComponents("suggestions", ownerId, sizes, []),
            });
            trackTodoListState(interaction.channelId, interaction.message?.id, "suggestions", ownerId, sizes);
            return;
        }
        const includeDetails = filter !== "all" && filter !== "completed";
        const todos = filter === "completed"
            ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
            : await listTodos(false, MAX_LIST_ITEMS);
        const filteredTodos = sizes.length
            ? todos.filter((item) => item.todoSize && sizes.includes(item.todoSize))
            : todos;
        const filteredTodosByQuery = filterTodosByQuery(filteredTodos, query);
        const response = buildTodoListEmbed(filteredTodosByQuery, filter === "completed", footerText, filter, includeDetails, query);
        await safeUpdate(interaction, {
            ...response,
            components: buildTodoListComponents(filter, ownerId, sizes, filteredTodosByQuery),
        });
        trackTodoListState(interaction.channelId, interaction.message?.id, filter, ownerId, sizes);
    }
    async handleTodoComplete(interaction) {
        const [, filterRaw, ownerId, sizeRaw] = interaction.customId.split(":");
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: "This menu isn't for you.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const ok = await isSuperAdmin(interaction);
        if (!ok)
            return;
        const todoId = Number(interaction.values?.[0]);
        if (!Number.isInteger(todoId) || todoId <= 0) {
            await interaction.reply({
                content: "Invalid TODO id.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const completed = await completeTodo(todoId, interaction.user.id);
        if (!completed) {
            await interaction.reply({
                content: `TODO #${todoId} was not found or already completed.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const sizes = parseSizeToken(sizeRaw);
        const filter = filterRaw;
        const query = extractTodoQueryFromMessage(interaction.message);
        const summary = await countTodoSummary();
        const suggestionCount = await countSuggestions();
        const footerText = buildAllTodoFooterText(summary, suggestionCount);
        if (filter === "suggestions") {
            const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
            const embed = buildSuggestionTabEmbed(suggestions, footerText);
            await safeUpdate(interaction, {
                embeds: [embed],
                components: buildTodoListComponents("suggestions", ownerId, sizes, []),
            });
            trackTodoListState(interaction.channelId, interaction.message?.id, "suggestions", ownerId, sizes);
            return;
        }
        const includeDetails = filter !== "all" && filter !== "completed";
        const todos = filter === "completed"
            ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
            : await listTodos(false, MAX_LIST_ITEMS);
        const filteredTodos = sizes.length
            ? todos.filter((item) => item.todoSize && sizes.includes(item.todoSize))
            : todos;
        const filteredTodosByQuery = filterTodosByQuery(filteredTodos, query);
        const response = buildTodoListEmbed(filteredTodosByQuery, filter === "completed", footerText, filter, includeDetails, query);
        await safeUpdate(interaction, {
            ...response,
            components: buildTodoListComponents(filter, ownerId, sizes, filteredTodosByQuery),
        });
        trackTodoListState(interaction.channelId, interaction.message?.id, filter, ownerId, sizes);
    }
};
__decorate([
    Slash({ description: "List bot development TODOs", name: "list" }),
    __param(0, SlashChoice(...TODO_TAB_OPTIONS)),
    __param(0, SlashOption({
        description: "Starting view (optional)",
        name: "mode",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashChoice(...TODO_SIZES)),
    __param(1, SlashOption({
        description: "Filter by effort size (optional)",
        name: "size",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(2, SlashOption({
        description: "Text filter (matches title or details)",
        name: "query",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
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
    __param(2, SlashChoice(...TODO_SIZES)),
    __param(2, SlashOption({
        description: "Effort size (XS/S/M/L/XL)",
        name: "size",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(3, SlashOption({
        description: "Optional details for the TODO",
        name: "details",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(4, SlashOption({
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
    __param(4, SlashChoice(...TODO_SIZES)),
    __param(4, SlashOption({
        description: "New effort size (optional, empty clears)",
        name: "size",
        required: false,
        type: ApplicationCommandOptionType.String,
    })),
    __param(5, SlashOption({
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
__decorate([
    SelectMenuComponent({
        id: /^todo-tab:(all|New Features|Improvements|Defects|Blocked|Refactoring|suggestions|completed):\d+:(?:any|[A-Z,]+)$/,
    })
], TodoCommand.prototype, "handleTodoTab", null);
__decorate([
    SelectMenuComponent({
        id: /^todo-size:(all|New Features|Improvements|Defects|Blocked|Refactoring|suggestions|completed):\d+:(?:any|[A-Z,]+)$/,
    })
], TodoCommand.prototype, "handleTodoSize", null);
__decorate([
    SelectMenuComponent({
        id: /^todo-complete:(all|New Features|Improvements|Defects|Blocked|Refactoring|suggestions|completed):\d+:(?:any|[A-Z,]+)$/,
    })
], TodoCommand.prototype, "handleTodoComplete", null);
TodoCommand = __decorate([
    Discord(),
    SlashGroup({ description: "Bot development TODOs (owner manages)", name: "todo" }),
    SlashGroup("todo")
], TodoCommand);
export { TodoCommand };
