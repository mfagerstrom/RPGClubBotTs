import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionsBitField,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonBuilder as V2ButtonBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "@discordjs/builders";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
import {
  AnyRepliable,
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import { countSuggestions } from "../classes/Suggestion.js";
import {
  addComment,
  closeIssue,
  createIssue,
  getIssue,
  listAllIssues,
  listIssueComments,
  setIssueLabels,
  updateIssue,
  type IGithubIssueComment,
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
const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 9;
const ISSUE_LIST_TITLE = "RPGClub GameDB GitHub Issues";
const TODO_LIST_ID_PREFIX = "todo-list-page";
const TODO_LIST_BACK_ID_PREFIX = "todo-list-back";
const TODO_VIEW_ID_PREFIX = "todo-view";
const TODO_CREATE_BUTTON_PREFIX = "todo-create-button";
const TODO_CREATE_LABEL_PREFIX = "todo-create-label";
const TODO_CREATE_SUBMIT_PREFIX = "todo-create-submit";
const TODO_CREATE_CANCEL_PREFIX = "todo-create-cancel";
const TODO_CREATE_MODAL_PREFIX = "todo-create-modal";
const TODO_CLOSE_BUTTON_PREFIX = "todo-close-button";
const TODO_CLOSE_SELECT_PREFIX = "todo-close-select";
const TODO_CLOSE_CANCEL_PREFIX = "todo-close-cancel";
const TODO_COMMENT_BUTTON_PREFIX = "todo-comment-button";
const TODO_COMMENT_MODAL_PREFIX = "todo-comment-modal";
const TODO_COMMENT_INPUT_ID = "todo-comment-input";
const TODO_EDIT_TITLE_BUTTON_PREFIX = "todo-edit-title-button";
const TODO_EDIT_TITLE_MODAL_PREFIX = "todo-edit-title-modal";
const TODO_EDIT_TITLE_INPUT_ID = "todo-edit-title-input";
const TODO_EDIT_DESC_BUTTON_PREFIX = "todo-edit-desc-button";
const TODO_EDIT_DESC_MODAL_PREFIX = "todo-edit-desc-modal";
const TODO_EDIT_DESC_INPUT_ID = "todo-edit-desc-input";
const TODO_CLOSE_VIEW_PREFIX = "todo-close-view";
const TODO_LABEL_EDIT_BUTTON_PREFIX = "todo-label-edit-button";
const TODO_LABEL_EDIT_SELECT_PREFIX = "todo-label-edit-select";
const TODO_QUERY_BUTTON_PREFIX = "todo-query-button";
const TODO_QUERY_MODAL_PREFIX = "todo-query-modal";
const TODO_QUERY_INPUT_ID = "todo-query-input";
const TODO_CREATE_TITLE_ID = "todo-create-title";
const TODO_CREATE_BODY_ID = "todo-create-body";
const TODO_LIST_SESSION_TTL_MS = 30 * 60 * 1000;
const TODO_CREATE_SESSION_TTL_MS = 10 * 60 * 1000;
const COMPONENTS_V2_FLAG = 1 << 15;

async function getSuggestionReviewCount(): Promise<number> {
  try {
    return await countSuggestions();
  } catch {
    return 0;
  }
}

type TodoListPayload = {
  page: number;
  perPage: number;
  state: ListState;
  stateFilters: ListState[];
  labels: TodoLabel[];
  query?: string;
  sort: ListSort;
  direction: ListDirection;
  isPublic: boolean;
};

type TodoListSession = {
  payload: Omit<TodoListPayload, "page">;
  createdAt: number;
  channelId?: string;
  messageId?: string;
};

type TodoCreateSession = {
  userId: string;
  listSessionId: string;
  page: number;
  title: string;
  body: string;
  labels: TodoLabel[];
  createdAt: number;
};

const todoListSessions = new Map<string, TodoListSession>();
const todoCreateSessions = new Map<string, TodoCreateSession>();

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function parseTodoLabels(rawValue: string | undefined): {
  labels: TodoLabel[];
  invalid: string[];
} {
  if (!rawValue) {
    return { labels: [], invalid: [] };
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const invalid: string[] = [];
  const labels: TodoLabel[] = [];

  tokens.forEach((token) => {
    const match = TODO_LABELS.find((label) => label.toLowerCase() === token.toLowerCase());
    if (match) {
      if (!labels.includes(match)) {
        labels.push(match);
      }
    } else {
      invalid.push(token);
    }
  });

  return { labels, invalid };
}

function normalizeQuery(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;
  const sanitized = sanitizeUserInput(rawValue, { preserveNewlines: false });
  return sanitized.length ? sanitized : undefined;
}

function matchesIssueQuery(issue: IGithubIssue, query: string): boolean {
  const haystackParts = [
    issue.title,
    issue.body ?? "",
    issue.labels.join(" "),
    issue.author ?? "",
    issue.state,
    String(issue.number),
    issue.createdAt,
    issue.updatedAt,
    issue.closedAt ?? "",
  ];

  const haystack = haystackParts.join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesIssueLabels(issue: IGithubIssue, labels: TodoLabel[]): boolean {
  if (!labels.length) return true;
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return labels.some((label) => issueLabels.includes(label.toLowerCase()));
}

function normalizeStateFilters(filters: ListState[]): ListState[] {
  const normalized = filters.filter((state) => state === "open" || state === "closed");
  if (!normalized.length) {
    return ["open"];
  }
  return Array.from(new Set(normalized));
}

function toIssueState(filters: ListState[]): ListState {
  const normalized = normalizeStateFilters(filters);
  if (normalized.length > 1) return "all";
  return normalized[0] ?? "open";
}

function formatDiscordTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "Unknown";
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

function getTodoPermissionFlags(interaction: AnyRepliable): {
  isOwner: boolean;
  isAdmin: boolean;
  isModerator: boolean;
} | null {
  const guild = interaction.guild;
  if (!guild) return null;

  const member: any = interaction.member;
  const canCheck = member && typeof member.permissionsIn === "function" && interaction.channel;
  const isOwner = guild.ownerId === interaction.user.id;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;
  const isModerator = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages)
    : false;

  return { isOwner, isAdmin, isModerator };
}

async function requireModeratorOrAdminOrOwner(
  interaction: AnyRepliable,
): Promise<boolean> {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (permissions.isOwner || permissions.isAdmin || permissions.isModerator) {
    return true;
  }

  await safeReply(interaction, {
    content: "Access denied. Command requires Moderator, Administrator, or server owner.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

async function requireOwner(interaction: AnyRepliable): Promise<boolean> {
  const permissions = getTodoPermissionFlags(interaction);
  if (!permissions) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (permissions.isOwner) {
    return true;
  }

  await safeReply(interaction, {
    content: "Access denied. Command requires server owner.",
    flags: MessageFlags.Ephemeral,
  });
  return false;
}

function getGithubErrorMessage(error: any): string {
  const status = error?.response?.status as number | undefined;
  const message = error?.response?.data?.message as string | undefined;
  const errorMessage = error?.message as string | undefined;

  const outputParts: string[] = [];
  if (status) {
    outputParts.push(`Github status: ${status}`);
  }
  if (message) {
    outputParts.push(`Github error: ${message}`);
  } else if (errorMessage) {
    outputParts.push(`Github error: ${errorMessage}`);
  }

  if (outputParts.length) {
    return outputParts.join("\n");
  }
  return "GitHub request failed. Check the GitHub App configuration.";
}

function formatIssueLink(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const linkText = `#${issue.number} ${issue.title}`;
  if (issue.htmlUrl) {
    return `[${linkText}](${issue.htmlUrl})${labelText}`;
  }
  return `${linkText}${labelText}`;
}

function formatIssueTitle(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  return `#${issue.number}: ${issue.title}${labelText}`;
}

function formatIssueSelectLabel(issue: IGithubIssue): string {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const text = `#${issue.number} ${issue.title}${labelText}`;
  if (text.length <= 100) return text;
  return `${text.slice(0, 97)}...`;
}

function buildIssueCommentsText(comments: IGithubIssueComment[]): string {
  if (!comments.length) return "";
  const lines: string[] = ["**Comments:**"];
  comments.slice(0, 3).forEach((comment) => {
    const author = comment.author ?? "Unknown";
    const createdAt = formatDiscordTimestamp(comment.createdAt);
    const body = sanitizeUserInput(comment.body, { preserveNewlines: true }).slice(0, 500);
    lines.push(`- **${author}** ${createdAt}`);
    lines.push(`  ${body || "*No comment content.*"}`);
  });
  if (comments.length > 3) {
    lines.push(`- *(+${comments.length - 3} more)*`);
  }
  return lines.join("\n");
}

function createTodoListSession(payload: Omit<TodoListPayload, "page">): string {
  const sessionId = `todo-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  todoListSessions.set(sessionId, { payload, createdAt: Date.now() });
  return sessionId;
}

function buildTodoListCustomId(sessionId: string, page: number): string {
  return [TODO_LIST_ID_PREFIX, sessionId, page].join(":");
}

function buildTodoListBackId(sessionId: string, page: number): string {
  return [TODO_LIST_BACK_ID_PREFIX, sessionId, page].join(":");
}

function buildTodoCreateButtonId(sessionId: string, page: number): string {
  return [TODO_CREATE_BUTTON_PREFIX, sessionId, page].join(":");
}

function buildTodoCreateModalId(sessionId: string, page: number): string {
  return [TODO_CREATE_MODAL_PREFIX, sessionId, page].join(":");
}

function buildTodoCloseButtonId(sessionId: string, page: number): string {
  return [TODO_CLOSE_BUTTON_PREFIX, sessionId, page].join(":");
}

function buildTodoCloseSelectId(sessionId: string, page: number): string {
  return [TODO_CLOSE_SELECT_PREFIX, sessionId, page].join(":");
}

function buildTodoCloseCancelId(sessionId: string): string {
  return [TODO_CLOSE_CANCEL_PREFIX, sessionId].join(":");
}

function buildTodoCommentButtonId(sessionId: string, page: number, issueNumber: number): string {
  return [TODO_COMMENT_BUTTON_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoCommentModalId(sessionId: string, page: number, issueNumber: number): string {
  return [TODO_COMMENT_MODAL_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoEditTitleButtonId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_TITLE_BUTTON_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoEditTitleModalId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_TITLE_MODAL_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoEditDescButtonId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_DESC_BUTTON_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoEditDescModalId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_EDIT_DESC_MODAL_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoCloseViewId(sessionId: string, page: number, issueNumber: number): string {
  return [TODO_CLOSE_VIEW_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoLabelEditButtonId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_LABEL_EDIT_BUTTON_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoLabelEditSelectId(
  sessionId: string,
  page: number,
  issueNumber: number,
): string {
  return [TODO_LABEL_EDIT_SELECT_PREFIX, sessionId, page, issueNumber].join(":");
}

function buildTodoQueryButtonId(sessionId: string, page: number): string {
  return [TODO_QUERY_BUTTON_PREFIX, sessionId, page].join(":");
}

function buildTodoQueryModalId(sessionId: string, page: number): string {
  return [TODO_QUERY_MODAL_PREFIX, sessionId, page].join(":");
}

function buildTodoCreateLabelId(sessionId: string): string {
  return [TODO_CREATE_LABEL_PREFIX, sessionId].join(":");
}

function buildTodoCreateSubmitId(sessionId: string): string {
  return [TODO_CREATE_SUBMIT_PREFIX, sessionId].join(":");
}

function buildTodoCreateCancelId(sessionId: string): string {
  return [TODO_CREATE_CANCEL_PREFIX, sessionId].join(":");
}

function buildTodoViewId(sessionId: string, page: number, issueNumber: number): string {
  return [TODO_VIEW_ID_PREFIX, sessionId, page, issueNumber].join(":");
}

function parseTodoListCustomId(id: string): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== TODO_LIST_ID_PREFIX) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function parseTodoListBackId(id: string): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== TODO_LIST_BACK_ID_PREFIX) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function parseTodoCreateId(
  id: string,
  prefix: string,
): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function parseTodoCreateSessionId(
  id: string,
  prefix: string,
): { sessionId: string } | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  if (!sessionId) {
    return null;
  }

  return { sessionId };
}

function parseTodoCloseId(
  id: string,
  prefix: string,
): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function parseTodoViewId(
  id: string,
): { sessionId: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== TODO_VIEW_ID_PREFIX) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!sessionId || !page || !issueNumber) {
    return null;
  }

  return { sessionId, page, issueNumber };
}

function parseTodoCommentId(
  id: string,
  prefix: string,
): { sessionId: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!sessionId || !page || !issueNumber) {
    return null;
  }

  return { sessionId, page, issueNumber };
}

function parseTodoCloseViewId(
  id: string,
  prefix: string,
): { sessionId: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!sessionId || !page || !issueNumber) {
    return null;
  }

  return { sessionId, page, issueNumber };
}

function parseTodoLabelEditId(
  id: string,
  prefix: string,
): { sessionId: string; page: number; issueNumber: number } | null {
  const parts = id.split(":");
  if (parts.length !== 4 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  const issueNumber = Number(parts[3]);
  if (!sessionId || !page || !issueNumber) {
    return null;
  }

  return { sessionId, page, issueNumber };
}

function parseTodoQueryId(
  id: string,
  prefix: string,
): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function parseTodoFilterId(
  id: string,
  prefix: string,
): { sessionId: string; page: number } | null {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== prefix) {
    return null;
  }

  const sessionId = parts[1];
  const page = Number(parts[2]);
  if (!sessionId || !page) {
    return null;
  }

  return { sessionId, page };
}

function getTodoListSession(sessionId: string): TodoListSession | null {
  const session = todoListSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > TODO_LIST_SESSION_TTL_MS) {
    todoListSessions.delete(sessionId);
    return null;
  }
  return session;
}

function updateTodoListSessionMessage(
  sessionId: string,
  channelId: string | null,
  messageId: string | null,
): void {
  if (!channelId || !messageId) return;
  const session = getTodoListSession(sessionId);
  if (!session) return;
  session.channelId = channelId;
  session.messageId = messageId;
  session.createdAt = Date.now();
  todoListSessions.set(sessionId, session);
}

function getTodoCreateSession(sessionId: string): TodoCreateSession | null {
  const session = todoCreateSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > TODO_CREATE_SESSION_TTL_MS) {
    todoCreateSessions.delete(sessionId);
    return null;
  }
  return session;
}

function createTodoCreateSession(
  userId: string,
  listSessionId: string,
  page: number,
): string {
  const sessionId = `todo-create-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  todoCreateSessions.set(sessionId, {
    userId,
    listSessionId,
    page,
    title: "",
    body: "",
    labels: [],
    createdAt: Date.now(),
  });
  return sessionId;
}

function buildTodoCreateFormComponents(
  session: TodoCreateSession,
  createSessionId: string,
): { components: Array<ContainerBuilder | ActionRowBuilder<any>> } {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Create GitHub Issue"),
  );

  const titleText = session.title ? session.title : "*No title set.*";
  const bodyText = session.body ? session.body : "*No description provided.*";
  const labelText = session.labels.length ? session.labels.join(", ") : "None";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Title:**\n${titleText}\n\n**Description:**\n${bodyText}\n\n**Labels:**\n${labelText}`,
    ),
  );

  const labelSelect = new StringSelectMenuBuilder()
    .setCustomId(buildTodoCreateLabelId(createSessionId))
    .setPlaceholder("Select Labels (multi-select)")
    .setMinValues(0)
    .setMaxValues(TODO_LABELS.length)
    .addOptions(
      TODO_LABELS.map((label) => ({
        label,
        value: label,
        default: session.labels.includes(label),
      })),
    );

  const labelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(labelSelect);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoCreateSubmitId(createSessionId))
      .setLabel("Create")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!session.title.trim().length),
    new ButtonBuilder()
      .setCustomId(buildTodoCreateCancelId(createSessionId))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  return { components: [container, labelRow, actionRow] };
}

function buildIssueListComponents(
  issues: IGithubIssue[],
  totalIssues: number,
  payload: TodoListPayload,
  sessionId: string,
  suggestionCount: number,
): { components: Array<ContainerBuilder | ActionRowBuilder<any>> } {
  const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
  const summaryParts = [
    `-# State: ${payload.state}`,
    payload.labels.length ? `Label: ${payload.labels.join(", ")}` : "Label: Any",
    payload.query ? `Query: ${payload.query}` : "Query: Any",
    `Sort: ${payload.sort} ${payload.direction}`,
    `Page: ${payload.page} of ${totalPages}`,
  ];
  if (suggestionCount > 0) {
    summaryParts.push(`${suggestionCount} suggestions awaiting review`);
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${ISSUE_LIST_TITLE}`));

  if (issues.length) {
    issues.forEach((issue) => {
      const section = new SectionBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatIssueLink(issue)),
      );
      section.setButtonAccessory(
        new V2ButtonBuilder()
          .setCustomId(buildTodoViewId(sessionId, payload.page, issue.number))
          .setLabel("View")
          .setStyle(ButtonStyle.Primary),
      );
      container.addSectionComponents(section);
    });
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No issues found for this filter."),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${summaryParts.join(" | ")} | Total: ${totalIssues}`,
    ),
  );

  const labelSelect = new StringSelectMenuBuilder()
    .setCustomId(`todo-filter-label:${sessionId}:${payload.page}`)
    .setPlaceholder("Filter by Label...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      [
        {
          label: "All Issues",
          value: "all",
          default: payload.labels.length === 0,
        },
        ...TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: payload.labels.includes(label),
        })),
      ],
    );
  const labelRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(labelSelect);

  const queryButton = new ButtonBuilder()
    .setCustomId(buildTodoQueryButtonId(sessionId, payload.page))
    .setLabel(payload.query ? "Edit Query" : "Filter by Query")
    .setStyle(ButtonStyle.Secondary);

  const createButton = new ButtonBuilder()
    .setCustomId(buildTodoCreateButtonId(sessionId, payload.page))
    .setLabel("Create Issue")
    .setStyle(ButtonStyle.Success);

  const closeButton = new ButtonBuilder()
    .setCustomId(buildTodoCloseButtonId(sessionId, payload.page))
    .setLabel("Close Issue")
    .setStyle(ButtonStyle.Danger);

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    createButton,
    closeButton,
    queryButton,
  );

  const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [
    container,
    labelRow,
    actionRow,
  ];
  if (totalPages > 1) {
    const prevDisabled = payload.page <= 1;
    const nextDisabled = payload.page >= totalPages;
    actionRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(sessionId, payload.page - 1))
        .setLabel("Prev Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(buildTodoListCustomId(sessionId, payload.page + 1))
        .setLabel("Next Page")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled),
    );
  }

  return { components };
}

function buildIssueViewComponents(
  issue: IGithubIssue,
  comments: IGithubIssueComment[],
  payload: TodoListPayload,
  sessionId: string,
): { components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> } {
  const container = new ContainerBuilder();
  const titleText = issue.htmlUrl
    ? `## [${formatIssueTitle(issue)}](${issue.htmlUrl})`
    : `## ${formatIssueTitle(issue)}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));

  const body = issue.body ? issue.body.slice(0, MAX_ISSUE_BODY) : "";
  if (body) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*No description provided.*"),
    );
  }

  const commentsText = buildIssueCommentsText(comments);
  if (commentsText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(commentsText));
  }

  const assignee = issue.assignee ?? "Unassigned";
  const footerLine = [
    `-# **State:** ${issue.state}`,
    `**Author:** ${issue.author ?? "Unknown"}`,
    `**Assignee:** ${assignee}`,
    `**Created:** ${formatDiscordTimestamp(issue.createdAt)}`,
    `**Updated:** ${formatDiscordTimestamp(issue.updatedAt)}`,
  ].join(" | ");
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLine));

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoCommentButtonId(sessionId, payload.page, issue.number))
      .setLabel("Add Comment")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditTitleButtonId(sessionId, payload.page, issue.number))
      .setLabel("Edit Title")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoEditDescButtonId(sessionId, payload.page, issue.number))
      .setLabel("Edit Description")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoLabelEditButtonId(sessionId, payload.page, issue.number))
      .setLabel("Add/Edit Labels")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildTodoCloseViewId(sessionId, payload.page, issue.number))
      .setLabel("Close Issue")
      .setStyle(ButtonStyle.Danger),
  );

  const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildTodoListBackId(sessionId, payload.page))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary),
  );

  return { components: [container, actionRow, backRow] };
}

@Discord()
export class TodoCommand {
  @Slash({ description: "List GitHub issues", name: "todo" })
  async list(
    @SlashOption({
      description: "Search text in any issue field",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    queryRaw: string | undefined,
    @SlashChoice(...LIST_STATES)
    @SlashOption({
      description: "Issue state",
      name: "state",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    state: ListState | undefined,
    @SlashOption({
      description: "Filter by labels (comma-separated)",
      name: "labels",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    labelsRaw: string | undefined,
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
    const isPublic = showInChat !== false;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(!isPublic) });

    const resolvedPerPage = clampNumber(perPage ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const parsedLabels = parseTodoLabels(labelsRaw);
    const query = normalizeQuery(queryRaw);
    if (parsedLabels.invalid.length) {
      await safeReply(interaction, {
        content:
          "Unknown labels: " +
          parsedLabels.invalid.join(", ") +
          `. Valid labels: ${TODO_LABELS.join(", ")}.`,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const initialStateFilters = normalizeStateFilters(
      state === "all" ? ["open", "closed"] : [state ?? "open"],
    );
    const effectiveState = toIssueState(initialStateFilters);

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: effectiveState,
        sort: sort ?? "updated",
        direction: direction ?? "desc",
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsedLabels.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, parsedLabels.labels));
    }
    if (query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, query));
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / resolvedPerPage));
    const resolvedPage = clampNumber(page ?? 1, 1, totalPages);
    const startIndex = (resolvedPage - 1) * resolvedPerPage;
    const pageIssues = issues.slice(startIndex, startIndex + resolvedPerPage);

    const payload: TodoListPayload = {
      page: resolvedPage,
      perPage: resolvedPerPage,
      state: effectiveState,
      stateFilters: initialStateFilters,
      labels: parsedLabels.labels,
      query,
      sort: sort ?? "updated",
      direction: direction ?? "desc",
      isPublic,
    };
    const sessionId = createTodoListSession({
      perPage: payload.perPage,
      state: payload.state,
      stateFilters: payload.stateFilters,
      labels: payload.labels,
      query: payload.query,
      sort: payload.sort,
      direction: payload.direction,
      isPublic: payload.isPublic,
    });
    const suggestionCount = await getSuggestionReviewCount();
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      payload,
      sessionId,
      suggestionCount,
    );

    await safeReply(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!isPublic),
      allowedMentions: { parse: [] },
    });

    try {
      const reply = await interaction.fetchReply();
      updateTodoListSessionMessage(sessionId, interaction.channelId, reply.id);
    } catch {
      // ignore fetch failures
    }
  }

  private async buildTodoListPayload(
    sessionId: string,
    page: number,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<any>>;
    payload: TodoListPayload;
    pageIssues: IGithubIssue[];
  } | null> {
    const session = getTodoListSession(sessionId);
    if (!session) return null;

    const payload: TodoListPayload = {
      ...session.payload,
      page,
    };
    const safePerPage = clampNumber(payload.perPage, 1, MAX_PAGE_SIZE);
    if (safePerPage !== payload.perPage) {
      payload.perPage = safePerPage;
      session.payload.perPage = safePerPage;
      todoListSessions.set(sessionId, session);
    }

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: payload.state,
        sort: payload.sort,
        direction: payload.direction,
      });
    } catch {
      return null;
    }

    if (payload.labels.length) {
      issues = issues.filter((issue) => matchesIssueLabels(issue, payload.labels));
    }
    if (payload.query) {
      issues = issues.filter((issue) => matchesIssueQuery(issue, payload.query as string));
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
    const safePage = clampNumber(payload.page, 1, totalPages);
    const startIndex = (safePage - 1) * payload.perPage;
    const pageIssues = issues.slice(startIndex, startIndex + payload.perPage);

    const suggestionCount = await getSuggestionReviewCount();
    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      { ...payload, page: safePage },
      sessionId,
      suggestionCount,
    );

    return {
      components: listPayload.components,
      payload: { ...payload, page: safePage },
      pageIssues,
    };
  }

  private async refreshExpiredList(interaction: AnyRepliable): Promise<void> {
    const isOwner = interaction.guild?.ownerId === interaction.user?.id;
    if (!isOwner) {
      await safeReply(interaction, {
        content: "This list view expired, so it has been refreshed. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      if ("message" in interaction && interaction.message?.deletable) {
        await interaction.message.delete();
      }
    } catch {
      // ignore delete failures
    }

    const channel = interaction.channel;
    if (!channel || !("send" in channel)) {
      return;
    }

    const payload: TodoListPayload = {
      page: 1,
      perPage: DEFAULT_PAGE_SIZE,
      state: "open",
      stateFilters: ["open"],
      labels: [],
      query: undefined,
      sort: "updated",
      direction: "desc",
      isPublic: true,
    };

    let issues: IGithubIssue[];
    try {
      issues = await listAllIssues({
        state: payload.state,
        sort: payload.sort,
        direction: payload.direction,
      });
    } catch {
      return;
    }

    const totalIssues = issues.length;
    const totalPages = Math.max(1, Math.ceil(totalIssues / payload.perPage));
    const safePage = clampNumber(payload.page, 1, totalPages);
    const startIndex = (safePage - 1) * payload.perPage;
    const pageIssues = issues.slice(startIndex, startIndex + payload.perPage);
    const suggestionCount = await getSuggestionReviewCount();

    const sessionId = createTodoListSession({
      perPage: payload.perPage,
      state: payload.state,
      stateFilters: payload.stateFilters,
      labels: payload.labels,
      query: payload.query,
      sort: payload.sort,
      direction: payload.direction,
      isPublic: payload.isPublic,
    });

    const listPayload = buildIssueListComponents(
      pageIssues,
      totalIssues,
      { ...payload, page: safePage },
      sessionId,
      suggestionCount,
    );

    try {
      const message = await (channel as any).send({
        components: listPayload.components,
        flags: buildComponentsV2Flags(false),
      });
      updateTodoListSessionMessage(sessionId, channel.id, message.id);
    } catch {
      // ignore send failures
    }
  }

  private async renderTodoListPage(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    sessionId: string,
    page: number,
  ): Promise<void> {
    const listPayload = await this.buildTodoListPayload(sessionId, page);
    if (!listPayload) {
      await this.refreshExpiredList(interaction);
      return;
    }

    await safeUpdate(interaction, {
      components: listPayload.components,
      flags: buildComponentsV2Flags(!listPayload.payload.isPublic),
    });

    updateTodoListSessionMessage(sessionId, interaction.channelId, interaction.message?.id ?? null);
  }

  @ButtonComponent({ id: /^todo-list-page:todo-\d+-\d+:\d+$/ })
  async listPage(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListCustomId(interaction.customId);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.sessionId, parsed.page);
  }

  @ButtonComponent({ id: /^todo-list-back:todo-\d+-\d+:\d+$/ })
  async listBack(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoListBackId(interaction.customId);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }
    await this.renderTodoListPage(interaction, parsed.sessionId, parsed.page);
  }

  @ButtonComponent({ id: /^todo-create-button:todo-\d+-\d+:\d+$/ })
  async createFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateId(interaction.customId, TODO_CREATE_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const modal = new ModalBuilder()
      .setCustomId(buildTodoCreateModalId(parsed.sessionId, parsed.page))
      .setTitle("Create GitHub Issue");

    const titleInput = new TextInputBuilder()
      .setCustomId(TODO_CREATE_TITLE_ID)
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256);

    const bodyInput = new TextInputBuilder()
      .setCustomId(TODO_CREATE_BODY_ID)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(bodyInput),
    );

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-close-button:todo-\d+-\d+:\d+$/ })
  async closeFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const listPayload = await this.buildTodoListPayload(parsed.sessionId, parsed.page);
    if (!listPayload) {
      await this.refreshExpiredList(interaction);
      return;
    }
    if (listPayload.pageIssues.length === 0) {
      await safeReply(interaction, {
        content: "No issues to close on this page.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(buildTodoCloseSelectId(parsed.sessionId, parsed.page))
      .setPlaceholder("Select an issue to close")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        listPayload.pageIssues.map((issue) => ({
          label: formatIssueSelectLabel(issue),
          value: String(issue.number),
        })),
      );
    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const cancelRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildTodoCloseCancelId(parsed.sessionId))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    await safeReply(interaction, {
      content: "Choose an issue to close.",
      components: [selectRow, cancelRow],
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: /^todo-filter-label:todo-\d+-\d+:\d+$/ })
  async filterLabel(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoFilterId(interaction.customId, "todo-filter-label");
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const selected = interaction.values[0];
    if (selected === "all") {
      session.payload.labels = [];
    } else {
      session.payload.labels = selected && TODO_LABELS.includes(selected as TodoLabel)
        ? [selected as TodoLabel]
        : [];
    }
    session.createdAt = Date.now();
    todoListSessions.set(parsed.sessionId, session);

    await this.renderTodoListPage(interaction, parsed.sessionId, 1);
  }

  @SelectMenuComponent({ id: /^todo-create-label:todo-create-\d+-\d+$/ })
  async setCreateLabels(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoCreateSessionId(interaction.customId, TODO_CREATE_LABEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This create form expired.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const session = getTodoCreateSession(parsed.sessionId);
    if (!session || session.userId !== interaction.user.id) {
      await safeUpdate(interaction, {
        components: [],
        content: "This create form expired.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const selectedValues = interaction.values;
    if (selectedValues.includes("all")) {
      session.labels = [];
    } else {
      session.labels = selectedValues
        .map((value) => TODO_LABELS.find((label) => label === value))
        .filter((label): label is TodoLabel => Boolean(label));
    }

    session.createdAt = Date.now();
    todoCreateSessions.set(parsed.sessionId, session);

    const formPayload = buildTodoCreateFormComponents(session, parsed.sessionId);
    await safeUpdate(interaction, {
      ...formPayload,
      flags: buildComponentsV2Flags(true),
    });
  }

  @SelectMenuComponent({ id: /^todo-close-select:todo-\d+-\d+:\d+$/ })
  async closeSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoCloseId(interaction.customId, TODO_CLOSE_SELECT_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This close menu expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    const issueNumber = Number(interaction.values[0]);
    if (!issueNumber) {
      await safeUpdate(interaction, {
        content: "Invalid issue selection.",
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!closed) {
      await safeUpdate(interaction, {
        content: `Issue #${issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session?.channelId || !session?.messageId) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.sessionId, parsed.page);
    if (!listPayload) {
      return;
    }

    const channel = interaction.client.channels.cache.get(session.channelId);
    if (!channel || !("messages" in channel)) {
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(session.messageId);
      await message.edit({
        components: listPayload.components,
      });
      updateTodoListSessionMessage(parsed.sessionId, session.channelId, session.messageId);
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @SelectMenuComponent({ id: /^todo-label-edit-select:todo-\d+-\d+:\d+:\d+$/ })
  async labelEditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parsed = parseTodoLabelEditId(interaction.customId, TODO_LABEL_EDIT_SELECT_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This label editor expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const selectedLabels = interaction.values
      .map((value) => TODO_LABELS.find((label) => label === value))
      .filter((label): label is TodoLabel => Boolean(label));

    let updated: IGithubIssue | null;
    try {
      updated = await setIssueLabels(parsed.issueNumber, selectedLabels);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!updated) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session?.channelId || !session?.messageId) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (issue) {
      const payload: TodoListPayload = {
        ...session.payload,
        page: parsed.page,
      };

      const viewPayload = buildIssueViewComponents(
        issue,
        comments,
        payload,
        parsed.sessionId,
      );

      const channel = interaction.client.channels.cache.get(session.channelId);
      if (channel && "messages" in channel) {
        try {
          const message = await (channel as any).messages.fetch(session.messageId);
          await message.edit({
            components: viewPayload.components,
          });
        } catch {
          // ignore refresh failures
        }
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-close-cancel:todo-\d+-\d+$/ })
  async closeCancel(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateSessionId(interaction.customId, TODO_CLOSE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This close menu expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeUpdate(interaction, {
      content: "Close issue cancelled.",
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ModalComponent({ id: /^todo-create-modal:todo-\d+-\d+:\d+$/ })
  async submitCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCreateId(interaction.customId, TODO_CREATE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This create form expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const rawTitle = interaction.fields.getTextInputValue(TODO_CREATE_TITLE_ID);
    const rawBody = interaction.fields.getTextInputValue(TODO_CREATE_BODY_ID);
    const trimmedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedBody = rawBody
      ? sanitizeUserInput(rawBody, { preserveNewlines: true })
      : "";
    if (!trimmedBody) {
      await safeReply(interaction, {
        content: "Description cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const createSessionId = createTodoCreateSession(
      interaction.user.id,
      parsed.sessionId,
      parsed.page,
    );
    const session = getTodoCreateSession(createSessionId);
    if (!session) {
      await safeReply(interaction, {
        content: "Unable to start issue creation.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    session.title = trimmedTitle;
    session.body = trimmedBody.slice(0, MAX_ISSUE_BODY);
    session.createdAt = Date.now();
    todoCreateSessions.set(createSessionId, session);

    const formPayload = buildTodoCreateFormComponents(session, createSessionId);
    await safeReply(interaction, {
      ...formPayload,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ModalComponent({ id: /^todo-comment-modal:todo-\d+-\d+:\d+:\d+$/ })
  async submitCommentModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_COMMENT_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This comment form expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawComment = interaction.fields.getTextInputValue(TODO_COMMENT_INPUT_ID);
    const trimmedComment = sanitizeUserInput(rawComment, { preserveNewlines: true });
    if (!trimmedComment) {
      await safeReply(interaction, {
        content: "Comment cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const prefixedComment = `${interaction.user.username}: ${trimmedComment}`.slice(
      0,
      MAX_ISSUE_BODY,
    );

    try {
      await addComment(parsed.issueNumber, prefixedComment);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session?.channelId || !session?.messageId) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = {
      ...session.payload,
      page: parsed.page,
    };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.sessionId,
    );

    const channel = interaction.client.channels.cache.get(session.channelId);
    if (!channel || !("messages" in channel)) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(session.messageId);
      await message.edit({
        components: viewPayload.components,
      });
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-title-modal:todo-\d+-\d+:\d+:\d+$/ })
  async submitEditTitleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_EDIT_TITLE_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This edit prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawTitle = interaction.fields.getTextInputValue(TODO_EDIT_TITLE_INPUT_ID);
    const trimmedTitle = sanitizeUserInput(rawTitle, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, {
        title: trimmedTitle,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session?.channelId || !session?.messageId) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = {
      ...session.payload,
      page: parsed.page,
    };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.sessionId,
    );

    const channel = interaction.client.channels.cache.get(session.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(session.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-edit-desc-modal:todo-\d+-\d+:\d+:\d+$/ })
  async submitEditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_EDIT_DESC_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This edit prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawBody = interaction.fields.getTextInputValue(TODO_EDIT_DESC_INPUT_ID);
    const trimmedBody = sanitizeUserInput(rawBody, { preserveNewlines: true });
    if (!trimmedBody) {
      await safeReply(interaction, {
        content: "Description cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateIssue(parsed.issueNumber, {
        body: trimmedBody.slice(0, MAX_ISSUE_BODY),
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session?.channelId || !session?.messageId) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch {
      issue = null;
    }

    if (!issue) {
      try {
        await interaction.deleteReply();
      } catch {
        // ignore
      }
      return;
    }

    const payload: TodoListPayload = {
      ...session.payload,
      page: parsed.page,
    };

    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.sessionId,
    );

    const channel = interaction.client.channels.cache.get(session.channelId);
    if (channel && "messages" in channel) {
      try {
        const message = await (channel as any).messages.fetch(session.messageId);
        await message.edit({
          components: viewPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ModalComponent({ id: /^todo-query-modal:todo-\d+-\d+:\d+$/ })
  async submitQueryModal(interaction: ModalSubmitInteraction): Promise<void> {
    const parsed = parseTodoQueryId(interaction.customId, TODO_QUERY_MODAL_PREFIX);
    if (!parsed) {
      await safeReply(interaction, {
        content: "This query prompt expired.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const rawQuery = interaction.fields.getTextInputValue(TODO_QUERY_INPUT_ID);
    const query = normalizeQuery(rawQuery);

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    session.payload.query = query;
    session.createdAt = Date.now();
    todoListSessions.set(parsed.sessionId, session);

    const listPayload = await this.buildTodoListPayload(parsed.sessionId, parsed.page);
    if (!listPayload) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const channel = interaction.client.channels.cache.get(session.channelId ?? "");
    if (channel && "messages" in channel && session.messageId) {
      try {
        const message = await (channel as any).messages.fetch(session.messageId);
        await message.edit({
          components: listPayload.components,
        });
      } catch {
        // ignore refresh failures
      }
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-create-submit:todo-create-\d+-\d+$/ })
  async submitCreateFromForm(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateSessionId(interaction.customId, TODO_CREATE_SUBMIT_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This create form expired.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const session = getTodoCreateSession(parsed.sessionId);
    if (!session || session.userId !== interaction.user.id) {
      await safeUpdate(interaction, {
        components: [],
        content: "This create form expired.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const trimmedTitle = sanitizeUserInput(session.title, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeUpdate(interaction, {
        content: "Title cannot be empty.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const trimmedBody = session.body
      ? sanitizeUserInput(session.body, { preserveNewlines: true })
      : undefined;
    const baseBody = trimmedBody ?? "";
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const prefixedBody = isOwner ? baseBody : `${interaction.user.username}: ${baseBody}`;
    const finalBody = prefixedBody.length ? prefixedBody.slice(0, MAX_ISSUE_BODY) : null;

    try {
      await createIssue({
        title: trimmedTitle,
        body: finalBody,
        labels: session.labels,
      });
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    todoCreateSessions.delete(parsed.sessionId);

    const listSession = getTodoListSession(session.listSessionId);
    if (!listSession?.channelId || !listSession?.messageId) {
      return;
    }

    const listPayload = await this.buildTodoListPayload(session.listSessionId, session.page);
    if (!listPayload) {
      return;
    }

    const channel = interaction.client.channels.cache.get(listSession.channelId);
    if (!channel || !("messages" in channel)) {
      return;
    }

    try {
      const message = await (channel as any).messages.fetch(listSession.messageId);
      await message.edit({
        components: listPayload.components,
      });
      updateTodoListSessionMessage(
        session.listSessionId,
        listSession.channelId,
        listSession.messageId,
      );
    } catch {
      // ignore refresh failures
    }

    try {
      await interaction.deleteReply();
    } catch {
      // ignore
    }
  }

  @ButtonComponent({ id: /^todo-create-cancel:todo-create-\d+-\d+$/ })
  async cancelCreateFromForm(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCreateSessionId(interaction.customId, TODO_CREATE_CANCEL_PREFIX);
    if (!parsed) {
      await safeUpdate(interaction, {
        components: [],
        content: "This create form expired.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    todoCreateSessions.delete(parsed.sessionId);
    try {
      await interaction.deleteReply();
    } catch {
      await safeUpdate(interaction, {
        content: "Create issue cancelled.",
        components: [],
        flags: buildComponentsV2Flags(true),
      });
    }
  }


  @ButtonComponent({ id: /^todo-view:todo-\d+-\d+:\d+:\d+$/ })
  async viewFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoViewId(interaction.customId);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    let issue: IGithubIssue | null;
    let comments: IGithubIssueComment[] = [];
    try {
      issue = await getIssue(parsed.issueNumber);
      if (issue) {
        comments = await listIssueComments(parsed.issueNumber);
      }
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (!issue) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const payload: TodoListPayload = {
      ...session.payload,
      page: parsed.page,
    };
    const viewPayload = buildIssueViewComponents(
      issue,
      comments,
      payload,
      parsed.sessionId,
    );

    await safeUpdate(interaction, {
      components: viewPayload.components,
      flags: buildComponentsV2Flags(!payload.isPublic),
    });
  }

  @ButtonComponent({ id: /^todo-close-view:todo-\d+-\d+:\d+:\d+$/ })
  async closeFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCloseViewId(interaction.customId, TODO_CLOSE_VIEW_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    let closed: IGithubIssue | null;
    try {
      closed = await closeIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeUpdate(interaction, {
        content: getGithubErrorMessage(err),
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!closed) {
      await safeUpdate(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        components: [],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const listPayload = await this.buildTodoListPayload(parsed.sessionId, parsed.page);
    if (!listPayload) {
      await this.refreshExpiredList(interaction);
      return;
    }

    try {
      await interaction.message.edit({
        components: listPayload.components,
      });
    } catch {
      await this.refreshExpiredList(interaction);
      return;
    }

    updateTodoListSessionMessage(
      parsed.sessionId,
      interaction.channelId,
      interaction.message?.id ?? null,
    );
  }

  @ButtonComponent({ id: /^todo-label-edit-button:todo-\d+-\d+:\d+:\d+$/ })
  async editLabelsFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoLabelEditId(interaction.customId, TODO_LABEL_EDIT_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireModeratorOrAdminOrOwner(interaction);
    if (!ok) return;

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch (err: any) {
      await safeReply(interaction, {
        content: getGithubErrorMessage(err),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(buildTodoLabelEditSelectId(parsed.sessionId, parsed.page, parsed.issueNumber))
      .setPlaceholder("Select Label(s)...")
      .setMinValues(0)
      .setMaxValues(TODO_LABELS.length)
      .addOptions(
        TODO_LABELS.map((label) => ({
          label,
          value: label,
          default: issue.labels.includes(label),
        })),
      );

    await safeReply(interaction, {
      content: "Select labels to apply to this issue.",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^todo-query-button:todo-\d+-\d+:\d+$/ })
  async queryFromList(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoQueryId(interaction.customId, TODO_QUERY_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(buildTodoQueryModalId(parsed.sessionId, parsed.page))
      .setTitle(session.payload.query ? "Edit Query" : "Filter by Query");

    const queryInput = new TextInputBuilder()
      .setCustomId(TODO_QUERY_INPUT_ID)
      .setLabel("Query")
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200);

    if (session.payload.query) {
      queryInput.setValue(session.payload.query);
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(queryInput));
    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-comment-button:todo-\d+-\d+:\d+:\d+$/ })
  async addCommentFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_COMMENT_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const session = getTodoListSession(parsed.sessionId);
    if (!session) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(buildTodoCommentModalId(parsed.sessionId, parsed.page, parsed.issueNumber))
      .setTitle("Add Comment");

    const commentInput = new TextInputBuilder()
      .setCustomId(TODO_COMMENT_INPUT_ID)
      .setLabel("Comment")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(commentInput));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-title-button:todo-\d+-\d+:\d+:\d+$/ })
  async editTitleFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_EDIT_TITLE_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(buildTodoEditTitleModalId(parsed.sessionId, parsed.page, parsed.issueNumber))
      .setTitle("Edit Title");

    const titleInput = new TextInputBuilder()
      .setCustomId(TODO_EDIT_TITLE_INPUT_ID)
      .setLabel("Title")
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(256)
      .setValue(issue.title);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput));

    await interaction.showModal(modal);
  }

  @ButtonComponent({ id: /^todo-edit-desc-button:todo-\d+-\d+:\d+:\d+$/ })
  async editDescriptionFromView(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseTodoCommentId(interaction.customId, TODO_EDIT_DESC_BUTTON_PREFIX);
    if (!parsed) {
      await this.refreshExpiredList(interaction);
      return;
    }

    const ok = await requireOwner(interaction);
    if (!ok) return;

    let issue: IGithubIssue | null;
    try {
      issue = await getIssue(parsed.issueNumber);
    } catch {
      issue = null;
    }

    if (!issue) {
      await safeReply(interaction, {
        content: `Issue #${parsed.issueNumber} was not found.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(buildTodoEditDescModalId(parsed.sessionId, parsed.page, parsed.issueNumber))
      .setTitle("Edit Description");

    const descriptionInput = new TextInputBuilder()
      .setCustomId(TODO_EDIT_DESC_INPUT_ID)
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ISSUE_BODY);

    if (issue.body) {
      descriptionInput.setValue(issue.body.slice(0, MAX_ISSUE_BODY));
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
    );

    await interaction.showModal(modal);
  }

}
