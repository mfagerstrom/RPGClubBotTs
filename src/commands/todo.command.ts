import type { Client, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import {
  completeTodo,
  createTodo,
  countTodoSummary,
  deleteTodo,
  fetchTodoById,
  listTodos,
  updateTodo,
  type ITodoItem,
} from "../classes/Todo.js";
import {
  countSuggestions,
  deleteSuggestion,
  getSuggestionById,
  listSuggestions,
  type ISuggestionItem,
} from "../classes/Suggestion.js";

const MAX_LIST_ITEMS: number = 100;
const MAX_TODO_DESCRIPTION: number = 3800;
const MAX_SUGGESTION_OPTIONS: number = 25;
const DEFAULT_TODO_CATEGORY = "Improvements";
const TODO_CATEGORIES = ["New Features", "Improvements", "Defects"] as const;
const TODO_SIZES = ["XS", "S", "M", "L", "XL"] as const;

type TodoCategory = (typeof TODO_CATEGORIES)[number];
type TodoSize = (typeof TODO_SIZES)[number];
type TodoFilter = "all" | "completed" | "suggestions" | TodoCategory;
type TodoListState = {
  messageId: string;
  filter: TodoFilter;
  ownerId: string;
  size: TodoSize | null;
};

const TODO_TAB_DEFINITIONS: Array<{ id: TodoFilter; label: string }> = [
  { id: "all", label: "All Open" },
  { id: "New Features", label: "New Features" },
  { id: "Improvements", label: "Improvements" },
  { id: "Defects", label: "Defects" },
  { id: "suggestions", label: "Suggestions" },
  { id: "completed", label: "Completed" },
];

const TODO_TAB_OPTIONS = TODO_TAB_DEFINITIONS.map((tab) => tab.label) as [
  "All Open",
  "New Features",
  "Improvements",
  "Defects",
  "Suggestions",
  "Completed",
];

const TODO_TAB_LABEL_TO_FILTER: Record<(typeof TODO_TAB_OPTIONS)[number], TodoFilter> = {
  "All Open": "all",
  "New Features": "New Features",
  Improvements: "Improvements",
  Defects: "Defects",
  Suggestions: "suggestions",
  Completed: "completed",
};

const latestTodoListByChannel = new Map<string, TodoListState>();

function buildTodoTabComponents(
  active: TodoFilter,
  ownerId: string,
  size: TodoSize | null,
): ActionRowBuilder<ButtonBuilder>[] {
  const sizeToken: string = size ?? "any";
  const buttons = TODO_TAB_DEFINITIONS.map((tab) =>
    new ButtonBuilder()
      .setCustomId(`todo-tab:${tab.id}:${ownerId}:${sizeToken}`)
      .setLabel(tab.label)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(tab.id === active),
  );
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)),
    );
  }
  return rows;
}

function trackTodoListState(
  channelId: string | null,
  messageId: string | undefined,
  filter: TodoFilter,
  ownerId: string,
  size: TodoSize | null,
): void {
  if (!channelId || !messageId) return;
  latestTodoListByChannel.set(channelId, { messageId, filter, ownerId, size });
}

function parseTodoListStateFromMessage(message: any): TodoListState | null {
  const components = message?.components ?? [];
  let activeFilter: TodoFilter | null = null;
  let ownerId: string | null = null;
  let size: TodoSize | null = null;

  for (const row of components) {
    const rowComponents = row?.components ?? [];
    for (const component of rowComponents) {
      const customId = component?.customId;
      if (typeof customId !== "string") continue;
      if (!customId.startsWith("todo-tab:")) continue;
      const [, filterRaw, ownerRaw, sizeRaw] = customId.split(":");
      if (!filterRaw || !ownerRaw) continue;
      if (component.disabled) {
        activeFilter = filterRaw as TodoFilter;
      }
      ownerId = ownerRaw;
      if (sizeRaw && TODO_SIZES.includes(sizeRaw as TodoSize)) {
        size = sizeRaw as TodoSize;
      }
    }
  }

  if (!activeFilter || !ownerId || !message?.id) return null;
  return { messageId: message.id, filter: activeFilter, ownerId, size };
}

async function findLatestTodoListState(
  channel: any,
): Promise<TodoListState | null> {
  if (!channel?.messages?.fetch) return null;
  const messages = await channel.messages.fetch({ limit: 50 });
  for (const message of messages.values()) {
    if (!message?.author?.bot) continue;
    const state = parseTodoListStateFromMessage(message);
    if (state) return state;
  }
  return null;
}

async function refreshLatestTodoList(
  channelId: string | null,
  client: Client,
): Promise<void> {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    let state = latestTodoListByChannel.get(channelId);
    if (!state) {
      const recovered = await findLatestTodoListState(channel);
      if (!recovered) return;
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
        components: buildTodoTabComponents("suggestions", state.ownerId, state.size),
      });
      return;
    }

    const includeDetails = state.filter !== "all" && state.filter !== "completed";
    const todos = state.filter === "completed"
      ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
      : await listTodos(false, MAX_LIST_ITEMS);
    const filteredTodos = state.size
      ? todos.filter((item) => item.todoSize === state.size)
      : todos;
    const response = buildTodoListEmbed(
      filteredTodos,
      state.filter === "completed",
      footerText,
      state.filter,
      includeDetails,
    );

    await message.edit({
      ...response,
      components: buildTodoTabComponents(state.filter, state.ownerId, state.size),
    });
  } catch {
    latestTodoListByChannel.delete(channelId);
  }
}
function formatTodoLines(items: ITodoItem[], includeDetails: boolean): string[] {
  const lines: string[] = [];
  const labelLengths: number[] = items.map((item) => `[${item.todoId}]`.length);
  const maxLabelLength: number = labelLengths.length
    ? Math.max(...labelLengths)
    : 0;
  const sizeLabelMap: Record<string, string> = {
    XS: "[XS]",
    S: "[S]",
    M: "[M]",
    L: "[L]",
    XL: "[XL]",
  };
  for (const item of items) {
    const statusSuffix: string = item.isCompleted ? " (Completed)" : "";
    const sizeLabel: string | null = item.todoSize
      ? (sizeLabelMap[item.todoSize] ?? null)
      : null;
    const sizeSuffix: string = sizeLabel ? ` ${sizeLabel}` : "";
    const labelRaw: string = `[${item.todoId}]`;
    const labelPadded: string = labelRaw.padStart(maxLabelLength, " ");
    const labelBlock: string = `\`${labelPadded}\``;
    lines.push(`**${labelBlock}** ${item.title}${statusSuffix}${sizeSuffix}`);
    if (includeDetails && item.details) {
      lines.push(`> ${item.details}`);
    }
  }
  return lines;
}

function buildCategoryTodoLines(
  items: ITodoItem[],
  category: TodoCategory,
  includeDetails: boolean,
): string[] {
  const categoryItems = items.filter((item) => item.todoCategory === category);
  if (!categoryItems.length) return [];
  return [`**${category}**`, ...formatTodoLines(categoryItems, includeDetails), ""];
}

function buildSuggestionLines(items: ISuggestionItem[]): string[] {
  if (!items.length) return ["No suggestions found."];
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`**[#${item.suggestionId}]** ${item.title}`);
    if (item.details) {
      lines.push(`> ${item.details}`);
    }
  }
  return lines;
}

function buildSuggestionTabEmbed(items: ISuggestionItem[], footerText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Suggestions")
    .setColor(0x3498db)
    .setDescription(buildSuggestionLines(items).join("\n"))
    .setFooter({ text: footerText });
}

function buildTodoActionEmbed(action: string, todo: ITodoItem): EmbedBuilder {
  const title = `${action} TODO #${todo.todoId} (${todo.todoCategory})`;
  const line = formatTodoLines([todo], false).join("\n");
  const description = todo.details ? `${line}\n> ${todo.details}` : line;
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x3498db)
    .setDescription(description);
}

function buildAllTodoFooterText(
  summary: {
    open: number;
    completed: number;
    openByCategory: { newFeatures: number; improvements: number; defects: number };
  },
  suggestionCount: number,
): string {
  return [
    `${summary.open} open TODOs`,
    `${summary.openByCategory.newFeatures} New Features`,
    `${summary.openByCategory.improvements} Improvements`,
    `${summary.openByCategory.defects} Defects`,
    `${suggestionCount} Suggestions`,
    `${summary.completed} Completed`,
  ].join(" | ");
}

function buildTodoDescription(
  items: ITodoItem[],
  includeCompleted: boolean,
  filter: TodoFilter,
  includeDetails: boolean,
): string {
  if (items.length === 0) {
    return includeCompleted ? "No TODO items found." : "No open TODO items found.";
  }

  const lines: string[] = [];
  if (filter === "all" || filter === "completed") {
    for (const category of TODO_CATEGORIES) {
      lines.push(...buildCategoryTodoLines(items, category, includeDetails));
    }
  } else if (filter !== "suggestions") {
    lines.push(...buildCategoryTodoLines(items, filter, includeDetails));
  }

  if (lines.length === 0) {
    return includeCompleted ? "No TODO items found." : "No open TODO items found.";
  }
  const trimmedLines: string[] = [];
  let currentLength: number = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line: string = lines[i];
    const nextLength: number = currentLength + line.length + 1;
    if (nextLength > MAX_TODO_DESCRIPTION) {
      const remaining: number = lines.length - i;
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

function buildTodoListEmbed(
  items: ITodoItem[],
  includeCompleted: boolean,
  footerText: string,
  filter: TodoFilter,
  includeDetails: boolean,
): { embeds: EmbedBuilder[] } {
  const description: string = buildTodoDescription(
    items,
    includeCompleted,
    filter,
    includeDetails,
  );
  const title: string = "Bot Development TODOs";

  const embed: EmbedBuilder = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x3498db)
    .setDescription(description)
    .setFooter({ text: footerText });

  return { embeds: [embed] };
}

function formatSuggestionLine(item: ISuggestionItem): string {
  const title = item.title;
  return `- **#${item.suggestionId}** ${title}`;
}

function buildSuggestionListEmbed(
  items: ISuggestionItem[],
): { embeds: EmbedBuilder[] } {
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

function buildSuggestionDetailEmbed(item: ISuggestionItem): EmbedBuilder {
  const createdBy = item.createdBy ? `<@${item.createdBy}>` : "Unknown";
  const createdAt = item.createdAt.toISOString().split("T")[0] ?? "n/a";

  const embed = new EmbedBuilder()
    .setTitle(`Suggestion #${item.suggestionId}`)
    .setDescription(item.title)
    .addFields(
      { name: "Submitted By", value: createdBy, inline: true },
      { name: "Submitted", value: createdAt, inline: true },
    );

  if (item.details) {
    embed.addFields({ name: "Details", value: item.details });
  }

  return embed;
}

@Discord()
@SlashGroup({ description: "Bot development TODOs (owner manages)", name: "todo" })
@SlashGroup("todo")
export class TodoCommand {
  @Slash({ description: "List bot development TODOs", name: "list" })
  async list(
    @SlashChoice(...TODO_TAB_OPTIONS)
    @SlashOption({
      description: "Starting view (optional)",
      name: "mode",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    mode: (typeof TODO_TAB_OPTIONS)[number] | undefined,
    @SlashChoice(...TODO_SIZES)
    @SlashOption({
      description: "Filter by effort size (optional)",
      name: "size",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    size: TodoSize | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic: boolean = Boolean(showInChat);
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
        components: buildTodoTabComponents("suggestions", interaction.user.id, size ?? null),
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      if (isPublic) {
        const replyMessage = reply ?? await interaction.fetchReply();
        trackTodoListState(
          interaction.channelId,
          replyMessage?.id,
          "suggestions",
          interaction.user.id,
          size ?? null,
        );
      }
      return;
    }

    const includeDetails = filter !== "all" && filter !== "completed";
    const todos = filter === "completed"
      ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
      : await listTodos(false, MAX_LIST_ITEMS);
    const filteredTodos = size
      ? todos.filter((item) => item.todoSize === size)
      : todos;
    const response = buildTodoListEmbed(
      filteredTodos,
      filter === "completed",
      footerText,
      filter,
      includeDetails,
    );
    const reply = await safeReply(interaction, {
      ...response,
      components: buildTodoTabComponents(filter, interaction.user.id, size ?? null),
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
    if (isPublic) {
      const replyMessage = reply ?? await interaction.fetchReply();
      trackTodoListState(interaction.channelId, replyMessage?.id, filter, interaction.user.id, size ?? null);
    }
  }

  @Slash({ description: "Review user suggestions", name: "review-suggestions" })
  async reviewSuggestions(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

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
      .addOptions(
        suggestions.map((item) => ({
          label: item.title.slice(0, 100),
          value: String(item.suggestionId),
          description: item.details ? item.details.slice(0, 95) : "No details",
        })),
      );

    await safeReply(interaction, {
      ...response,
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^todo-suggestion-select:\d+$/ })
  async handleSuggestionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
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
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`todo-suggestion-accept:${ownerId}:${suggestionId}`)
        .setLabel("Accept (Create TODO)")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`todo-suggestion-decline:${ownerId}:${suggestionId}`)
        .setLabel("Decline (Delete)")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.update({
      embeds: [embed],
      components: [buttons],
    });
  }

  @ButtonComponent({ id: /^todo-suggestion-accept:\d+:\d+$/ })
  async handleSuggestionAccept(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, suggestionIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This review prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await isSuperAdmin(interaction as any);
    if (!ok) return;

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

    const todo = await createTodo(
      suggestion.title,
      suggestion.details ?? null,
      DEFAULT_TODO_CATEGORY,
      null,
      suggestion.createdBy,
    );
    await deleteSuggestion(suggestionId);

    await interaction.update({
      content: `Accepted suggestion #${suggestionId} and created TODO #${todo.todoId}.`,
      embeds: [],
      components: [],
      files: [],
    });
    await refreshLatestTodoList(interaction.channelId, interaction.client);
  }

  @ButtonComponent({ id: /^todo-suggestion-decline:\d+:\d+$/ })
  async handleSuggestionDecline(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, suggestionIdRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This review prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await isSuperAdmin(interaction as any);
    if (!ok) return;

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

  @Slash({ description: "Add a bot development TODO", name: "add" })
  async add(
    @SlashOption({
      description: "Short TODO title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashChoice(...TODO_CATEGORIES)
    @SlashOption({
      description: "TODO category",
      name: "category",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    category: TodoCategory,
    @SlashOption({
      description: "Optional details for the TODO",
      name: "details",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    details: string | undefined,
    @SlashChoice(...TODO_SIZES)
    @SlashOption({
      description: "Optional effort size (XS/S/M/L/XL)",
      name: "size",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    size: TodoSize | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic: boolean = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

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
    const finalSize = size ?? null;
    const todo = await createTodo(
      trimmedTitle,
      trimmedDetails ?? null,
      category,
      finalSize,
      interaction.user.id,
    );
    await safeReply(interaction, {
      embeds: [buildTodoActionEmbed("Added", todo)],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
    await refreshLatestTodoList(interaction.channelId, interaction.client);
  }

  @Slash({ description: "Edit an existing bot development TODO", name: "edit" })
  async edit(
    @SlashOption({
      description: "TODO id",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    todoId: number,
    @SlashOption({
      description: "New title (optional)",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "New details (optional, empty clears)",
      name: "details",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    details: string | undefined,
    @SlashChoice(...TODO_CATEGORIES)
    @SlashOption({
      description: "New category (optional)",
      name: "category",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    category: TodoCategory | undefined,
    @SlashChoice(...TODO_SIZES)
    @SlashOption({
      description: "New effort size (optional, empty clears)",
      name: "size",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    size: TodoSize | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic: boolean = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

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

  @Slash({ description: "Delete a bot development TODO", name: "delete" })
  async delete(
    @SlashOption({
      description: "TODO id",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    todoId: number,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic: boolean = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

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

  @Slash({ description: "Mark a bot development TODO as completed", name: "complete" })
  async complete(
    @SlashOption({
      description: "TODO id",
      name: "id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    todoId: number,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic: boolean = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

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

  @ButtonComponent({
    id: /^todo-tab:(all|New Features|Improvements|Defects|suggestions|completed):\d+:(XS|S|M|L|XL|any)$/,
  })
  async handleTodoTab(interaction: ButtonInteraction): Promise<void> {
    const [filter, ownerId, sizeRaw] = interaction.customId.split(":").slice(1);
    if (interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "This menu isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const size = sizeRaw && TODO_SIZES.includes(sizeRaw as TodoSize)
      ? (sizeRaw as TodoSize)
      : null;
    const summary = await countTodoSummary();
    const suggestionCount = await countSuggestions();
    const footerText = buildAllTodoFooterText(summary, suggestionCount);

    if (filter === "suggestions") {
      const suggestions = await listSuggestions(MAX_SUGGESTION_OPTIONS);
      const embed = buildSuggestionTabEmbed(suggestions, footerText);
      await safeUpdate(interaction, {
        embeds: [embed],
        components: buildTodoTabComponents("suggestions", ownerId, size),
      });
      trackTodoListState(interaction.channelId, interaction.message?.id, "suggestions", ownerId, size);
      return;
    }

    const includeDetails = filter !== "all" && filter !== "completed";
    const todos = filter === "completed"
      ? (await listTodos(true, MAX_LIST_ITEMS)).filter((item) => item.isCompleted)
      : await listTodos(false, MAX_LIST_ITEMS);
    const filteredTodos = size
      ? todos.filter((item) => item.todoSize === size)
      : todos;
    const response = buildTodoListEmbed(
      filteredTodos,
      filter === "completed",
      footerText,
      filter as TodoFilter,
      includeDetails,
    );

    await safeUpdate(interaction, {
      ...response,
      components: buildTodoTabComponents(filter as TodoFilter, ownerId, size),
    });
    trackTodoListState(
      interaction.channelId,
      interaction.message?.id,
      filter as TodoFilter,
      ownerId,
      size,
    );
  }
}
