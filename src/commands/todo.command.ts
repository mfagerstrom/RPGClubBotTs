import type { CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
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
  SlashGroup,
  SlashOption,
} from "discordx";
import { readFileSync } from "fs";
import path from "path";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
  type ITodoItem,
} from "../classes/Todo.js";
import {
  deleteSuggestion,
  getSuggestionById,
  listSuggestions,
  type ISuggestionItem,
} from "../classes/Suggestion.js";

const MAX_LIST_ITEMS: number = 100;
const MAX_TODO_DESCRIPTION: number = 3800;
const MAX_SUGGESTION_OPTIONS: number = 25;
const GAME_DB_THUMB_NAME: string = "gameDB.png";
const GAME_DB_THUMB_PATH: string = path.join(
  process.cwd(),
  "src",
  "assets",
  "images",
  GAME_DB_THUMB_NAME,
);
const gameDbThumbBuffer: Buffer = readFileSync(GAME_DB_THUMB_PATH);

function buildGameDbThumbAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}

function applyGameDbThumbnail(embed: EmbedBuilder): EmbedBuilder {
  return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}

function formatDate(value: Date | null): string {
  if (!value) return "n/a";
  return value.toISOString().split("T")[0] ?? "n/a";
}

function formatTodoLines(items: ITodoItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const status: string = item.isCompleted ? "Completed" : "Open";
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

function buildTodoDescription(items: ITodoItem[], includeCompleted: boolean): string {
  if (items.length === 0) {
    return includeCompleted ? "No TODO items found." : "No open TODO items found.";
  }

  const lines: string[] = formatTodoLines(items);
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

  return trimmedLines.join("\n");
}

function buildTodoListEmbed(
  items: ITodoItem[],
  includeCompleted: boolean,
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } {
  const description: string = buildTodoDescription(items, includeCompleted);
  const openCount: number = items.filter((item) => !item.isCompleted).length;
  const completedCount: number = items.filter((item) => item.isCompleted).length;
  const title: string = includeCompleted ? "Bot TODOs" : "Open Bot TODOs";
  const footerText: string = `${openCount} open | ${completedCount} completed`;

  const embed: EmbedBuilder = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footerText });
  applyGameDbThumbnail(embed);

  const files: AttachmentBuilder[] = [buildGameDbThumbAttachment()];
  return { embeds: [embed], files };
}

function formatSuggestionLine(item: ISuggestionItem): string {
  const title = item.title;
  return `- **#${item.suggestionId}** ${title}`;
}

function buildSuggestionListEmbed(
  items: ISuggestionItem[],
): { embeds: EmbedBuilder[]; files: AttachmentBuilder[] } {
  if (items.length === 0) {
    const emptyEmbed = new EmbedBuilder()
      .setTitle("Suggestions")
      .setDescription("No suggestions found.");
    applyGameDbThumbnail(emptyEmbed);
    return { embeds: [emptyEmbed], files: [buildGameDbThumbAttachment()] };
  }

  const lines = items.map((item) => formatSuggestionLine(item));
  const description = lines.join("\n");
  const embed = new EmbedBuilder()
    .setTitle("Suggestions")
    .setDescription(description)
    .setFooter({ text: `${items.length} suggestion(s)` });
  applyGameDbThumbnail(embed);

  return { embeds: [embed], files: [buildGameDbThumbAttachment()] };
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

  applyGameDbThumbnail(embed);
  return embed;
}

@Discord()
@SlashGroup({ description: "Bot development TODOs (owner manages)", name: "todo" })
@SlashGroup("todo")
export class TodoCommand {
  @Slash({ description: "List bot development TODOs", name: "list" })
  async list(
    @SlashOption({
      description: "Include completed TODOs",
      name: "include_completed",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    includeCompleted: boolean | undefined,
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

    const todos: ITodoItem[] = await listTodos(Boolean(includeCompleted), MAX_LIST_ITEMS);
    const response = buildTodoListEmbed(todos, Boolean(includeCompleted));
    await safeReply(interaction, {
      ...response,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
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
      files: [buildGameDbThumbAttachment()],
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
      suggestion.createdBy,
    );
    await deleteSuggestion(suggestionId);

    await interaction.update({
      content: `Accepted suggestion #${suggestionId} and created TODO #${todo.todoId}.`,
      embeds: [],
      components: [],
      files: [],
    });
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
    @SlashOption({
      description: "Optional details for the TODO",
      name: "details",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    details: string | undefined,
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

    const trimmedDetails = details?.trim();
    const todo = await createTodo(trimmedTitle, trimmedDetails ?? null, interaction.user.id);
    await safeReply(interaction, {
      content: `Added TODO #${todo.todoId}: ${todo.title}`,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
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

    const removed = await deleteTodo(todoId);
    await safeReply(interaction, {
      content: removed ? `Deleted TODO #${todoId}.` : `TODO #${todoId} was not found.`,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
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

    const completed = await completeTodo(todoId, interaction.user.id);
    await safeReply(interaction, {
      content: completed
        ? `Marked TODO #${todoId} as completed.`
        : `TODO #${todoId} was not found or already completed.`,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }
}
