import type { CommandInteraction } from "discord.js";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
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

const MAX_LIST_ITEMS: number = 100;
const MAX_TODO_DESCRIPTION: number = 3800;
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
