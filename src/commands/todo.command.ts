import type { CommandInteraction } from "discord.js";
import {
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import {
  Discord,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { isSuperAdmin } from "./superadmin.command.js";
import {
  addComment,
  addLabels,
  closeIssue,
  createIssue,
  getIssue,
  getRepoDisplayName,
  listIssues,
  removeLabel,
  reopenIssue,
  updateIssue,
  type IGithubIssue,
} from "../services/GithubIssuesService.js";

const TODO_LABELS = ["New Feature", "Improvement", "Bug", "Blocked"] as const;
const LIST_STATES = ["open", "closed", "all"] as const;
const LIST_SORTS = ["created", "updated"] as const;
const LIST_DIRECTIONS = ["asc", "desc"] as const;

type TodoLabel = (typeof TODO_LABELS)[number];
type ListState = (typeof LIST_STATES)[number];
type ListSort = (typeof LIST_SORTS)[number];
type ListDirection = (typeof LIST_DIRECTIONS)[number];

const MAX_ISSUE_BODY = 4000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 25;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getGithubErrorMessage(error: any): string {
  const status = error?.response?.status as number | undefined;
  const message = error?.response?.data?.message as string | undefined;
  if (status && message) {
    return `GitHub error (${status}): ${message}`;
  }
  return "GitHub request failed. Check the GitHub App configuration.";
}

function formatIssueLine(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  return `#${issue.number} ${issue.title}${labelText}`;
}

function buildIssueListEmbed(
  issues: IGithubIssue[],
  state: ListState,
  label: TodoLabel | undefined,
  page: number,
  perPage: number,
  sort: ListSort,
  direction: ListDirection,
  repo: string,
): EmbedBuilder {
  const title = `/todo list (${repo})`;
  const summaryParts = [
    `State: ${state}`,
    label ? `Label: ${label}` : "Label: Any",
    `Sort: ${sort} ${direction}`,
    `Page: ${page}`,
  ];

  const description = issues.length
    ? issues.map((issue) => `- ${formatIssueLine(issue)}`).join("\n")
    : "No issues found for this filter.";

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setFooter({
      text: `${summaryParts.join(" | ")} | Showing ${issues.length} of ${perPage}`,
    });
}

function buildIssueDetailEmbed(issue: IGithubIssue, repo: string): EmbedBuilder {
  const body = issue.body ? issue.body.slice(0, MAX_ISSUE_BODY) : "";
  const embed = new EmbedBuilder()
    .setTitle(`#${issue.number} ${issue.title}`)
    .setURL(issue.htmlUrl)
    .setDescription(body)
    .addFields(
      { name: "Repository", value: repo, inline: true },
      { name: "State", value: issue.state, inline: true },
    );

  if (issue.labels.length) {
    embed.addFields({ name: "Labels", value: issue.labels.join(", ") });
  }

  if (issue.author) {
    embed.addFields({ name: "Author", value: issue.author, inline: true });
  }

  embed.addFields(
    { name: "Created", value: issue.createdAt, inline: true },
    { name: "Updated", value: issue.updatedAt, inline: true },
  );

  if (issue.closedAt) {
    embed.addFields({ name: "Closed", value: issue.closedAt, inline: true });
  }

  return embed;
}

@Discord()
@SlashGroup({ description: "GitHub issue controls", name: "todo" })
@SlashGroup("todo")
export class TodoCommand {
  @Slash({ description: "List GitHub issues", name: "list" })
  async list(
    @SlashChoice(...LIST_STATES)
    @SlashOption({
      description: "Issue state",
      name: "state",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    state: ListState | undefined,
    @SlashChoice(...TODO_LABELS)
    @SlashOption({
      description: "Filter by label",
      name: "label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    label: TodoLabel | undefined,
    @SlashChoice(...LIST_SORTS)
    @SlashOption({
      description: "Sort order",
      name: "sort",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    sort: ListSort | undefined,
    @SlashChoice(...LIST_DIRECTIONS)
    @SlashOption({
      description: "Sort direction",
      name: "direction",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    direction: ListDirection | undefined,
    @SlashOption({
      description: "Page number",
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    @SlashOption({
      description: "Results per page",
      name: "per_page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    perPage: number | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    const resolvedPage = clampNumber(page ?? 1, 1, 100);
    const resolvedPerPage = clampNumber(perPage ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

    let issues: IGithubIssue[];
    try {
      issues = await listIssues({
        state: state ?? "open",
        labels: label ? [label] : undefined,
        sort: sort ?? "updated",
        direction: direction ?? "desc",
        page: resolvedPage,
        perPage: resolvedPerPage,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const repo = getRepoDisplayName();
    const embed = buildIssueListEmbed(
      issues,
      state ?? "open",
      label,
      resolvedPage,
      resolvedPerPage,
      sort ?? "updated",
      direction ?? "desc",
      repo,
    );

    await safeReply(interaction, {
      embeds: [embed],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  @Slash({ description: "View a GitHub issue", name: "view" })
  async view(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = Boolean(showInChat);
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(number);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${number} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildIssueDetailEmbed(issue, getRepoDisplayName());
    await safeReply(interaction, {
      embeds: [embed],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  @Slash({ description: "Create a GitHub issue", name: "create" })
  async create(
    @SlashOption({
      description: "Issue title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Issue body",
      name: "body",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    body: string | undefined,
    @SlashChoice(...TODO_LABELS)
    @SlashOption({
      description: "Optional label",
      name: "label",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    label: TodoLabel | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    const trimmedTitle = sanitizeUserInput(title, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedBody = body
      ? sanitizeUserInput(body, { preserveNewlines: true })
      : undefined;
    const finalBody = trimmedBody
      ? trimmedBody.slice(0, MAX_ISSUE_BODY)
      : null;

    let issue: IGithubIssue;
    try {
      issue = await createIssue({
        title: trimmedTitle,
        body: finalBody,
        labels: label ? [label] : [],
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildIssueDetailEmbed(issue, getRepoDisplayName());
    await safeReply(interaction, {
      content: `Created issue #${issue.number}.`,
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  @Slash({ description: "Edit a GitHub issue", name: "edit" })
  async edit(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    @SlashOption({
      description: "New title",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "New body",
      name: "body",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    body: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    if (title === undefined && body === undefined) {
      await safeReply(interaction, {
        content: "Provide a title or body to update.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedTitle = title === undefined
      ? undefined
      : sanitizeUserInput(title, { preserveNewlines: false });
    if (title !== undefined && !trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty when provided.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedBody = body === undefined
      ? undefined
      : sanitizeUserInput(body, { preserveNewlines: true });
    const finalBody = trimmedBody === undefined
      ? undefined
      : trimmedBody
        ? trimmedBody.slice(0, MAX_ISSUE_BODY)
        : "";

    let updated: IGithubIssue | null;
    try {
      updated = await updateIssue(number, {
        title: trimmedTitle,
        body: finalBody,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!updated) {
      await safeReply(interaction, {
        content: `Issue #${number} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = buildIssueDetailEmbed(updated, getRepoDisplayName());
    await safeReply(interaction, {
      content: `Updated issue #${updated.number}.`,
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  @Slash({ description: "Close a GitHub issue", name: "close" })
  async close(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(number);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!closed) {
      await safeReply(interaction, {
        content: `Issue #${number} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Closed issue #${number}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Reopen a GitHub issue", name: "reopen" })
  async reopen(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    let reopened: IGithubIssue | null;
    try {
      reopened = await reopenIssue(number);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!reopened) {
      await safeReply(interaction, {
        content: `Issue #${number} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Reopened issue #${number}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Comment on a GitHub issue", name: "comment" })
  async comment(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    @SlashOption({
      description: "Comment body",
      name: "body",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    body: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    const trimmedBody = sanitizeUserInput(body, { preserveNewlines: true });
    if (!trimmedBody) {
      await safeReply(interaction, {
        content: "Comment body cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await addComment(number, trimmedBody.slice(0, MAX_ISSUE_BODY));
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await safeReply(interaction, {
      content: `Added a comment to issue #${number}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Add a label to a GitHub issue", name: "label-add" })
  async labelAdd(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    @SlashChoice(...TODO_LABELS)
    @SlashOption({
      description: "Label to add",
      name: "label",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    label: TodoLabel,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    try {
      await addLabels(number, [label]);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await safeReply(interaction, {
      content: `Added label ${label} to issue #${number}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Remove a label from a GitHub issue", name: "label-remove" })
  async labelRemove(
    @SlashOption({
      description: "Issue number",
      name: "number",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    number: number,
    @SlashChoice(...TODO_LABELS)
    @SlashOption({
      description: "Label to remove",
      name: "label",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    label: TodoLabel,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const ok = await isSuperAdmin(interaction);
    if (!ok) return;

    try {
      await removeLabel(number, label);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await safeReply(interaction, {
      content: `Removed label ${label} from issue #${number}.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
