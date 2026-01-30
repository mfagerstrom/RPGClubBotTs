import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashOption,
} from "discordx";
import {
  safeDeferReply,
  safeReply,
  safeUpdate,
  sanitizeUserInput,
} from "../functions/InteractionUtils.js";
import {
  createSuggestion,
  deleteSuggestion,
  getSuggestionById,
  listSuggestions,
  countSuggestions,
} from "../classes/Suggestion.js";
import { createIssue } from "../services/GithubIssuesService.js";
import { BOT_DEV_CHANNEL_ID } from "../config/channels.js";

const BOT_DEV_PING_USER_ID = "191938640413327360";
const SUGGESTION_APPROVE_PREFIX = "suggestion-approve";
const SUGGESTION_LABEL_SELECT_PREFIX = "suggestion-labels";
const SUGGESTION_SUBMIT_PREFIX = "suggestion-submit";
const SUGGESTION_CANCEL_PREFIX = "suggestion-cancel";
const SUGGESTION_LABELS = ["New Feature", "Improvement", "Bug", "Blocked"] as const;
type SuggestionLabel = (typeof SUGGESTION_LABELS)[number];
type SuggestionDraft = {
  userId: string;
  title: string;
  details: string;
  labels: SuggestionLabel[];
  createdAt: number;
};
const SUGGESTION_DRAFT_TTL_MS = 10 * 60 * 1000;
const suggestionDrafts = new Map<string, SuggestionDraft>();
const SUGGESTION_REVIEW_PREFIX = "suggestion-review";
const SUGGESTION_REVIEW_TTL_MS = 15 * 60 * 1000;
const COMPONENTS_V2_FLAG = 1 << 15;
type SuggestionReviewSession = {
  userId: string;
  suggestionIds: number[];
  index: number;
  createdAt: number;
  totalCount: number;
};
const suggestionReviewSessions = new Map<string, SuggestionReviewSession>();

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function buildSuggestionReviewActionId(action: string, sessionId: string): string {
  return `${SUGGESTION_REVIEW_PREFIX}:${action}:${sessionId}`;
}

function parseSuggestionReviewActionId(
  customId: string,
): { action: string; sessionId: string } | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== SUGGESTION_REVIEW_PREFIX) {
    return null;
  }
  const [, action, sessionId] = parts;
  return action && sessionId ? { action, sessionId } : null;
}

function createSuggestionReviewSession(
  userId: string,
  suggestionIds: number[],
  totalCount: number,
): string {
  const sessionId = `suggestion-review-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  suggestionReviewSessions.set(sessionId, {
    userId,
    suggestionIds,
    index: 0,
    createdAt: Date.now(),
    totalCount,
  });
  return sessionId;
}

function getSuggestionReviewSession(sessionId: string): SuggestionReviewSession | null {
  const session = suggestionReviewSessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.createdAt > SUGGESTION_REVIEW_TTL_MS) {
    suggestionReviewSessions.delete(sessionId);
    return null;
  }
  return session;
}

function formatSuggestionTimestamp(date: Date | null | undefined): string {
  if (!date) return "Unknown";
  const timestamp = Math.floor(date.getTime() / 1000);
  return `<t:${timestamp}:f>`;
}

function buildSuggestionReviewContainer(
  suggestion: Awaited<ReturnType<typeof getSuggestionById>>,
  index: number,
  total: number,
  totalCount: number,
): ContainerBuilder {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Suggestion Review"),
  );

  if (!suggestion) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("No pending suggestions found."),
    );
    return container;
  }

  const labels = suggestion.labels ? suggestion.labels : "None";
  const authorMention = suggestion.createdBy ? `<@${suggestion.createdBy}>` : "Unknown";
  const authorLabel = suggestion.createdByName
    ? `${authorMention} (${suggestion.createdByName})`
    : authorMention;
  const details = suggestion.details ?? "No details provided.";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `**Suggestion:** #${suggestion.suggestionId} - ${suggestion.title}`,
    ),
    new TextDisplayBuilder().setContent(`**Labels:** ${labels}`),
    new TextDisplayBuilder().setContent(`**Submitted by:** ${authorLabel}`),
    new TextDisplayBuilder().setContent(
      `**Submitted:** ${formatSuggestionTimestamp(suggestion.createdAt)}`,
    ),
    new TextDisplayBuilder().setContent(`**Position:** ${index + 1} of ${total}`),
  );

  if (totalCount > total) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Showing ${total} most recent suggestions out of ${totalCount}.`,
      ),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("**Details:**"),
    new TextDisplayBuilder().setContent(details),
  );

  return container;
}

function buildSuggestionReviewButtons(
  sessionId: string,
  hasSuggestion: boolean,
  hasNext: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  if (!hasSuggestion) return [];

  const approveButton = new ButtonBuilder()
    .setCustomId(buildSuggestionReviewActionId("approve", sessionId))
    .setLabel("Approve")
    .setStyle(ButtonStyle.Success);

  const rejectButton = new ButtonBuilder()
    .setCustomId(buildSuggestionReviewActionId("reject", sessionId))
    .setLabel("Reject")
    .setStyle(ButtonStyle.Danger);

  const nextButton = new ButtonBuilder()
    .setCustomId(buildSuggestionReviewActionId("next", sessionId))
    .setLabel(hasNext ? "Next" : "Finish")
    .setStyle(ButtonStyle.Secondary);

  const cancelButton = new ButtonBuilder()
    .setCustomId(buildSuggestionReviewActionId("cancel", sessionId))
    .setLabel("Close")
    .setStyle(ButtonStyle.Danger);

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(approveButton, rejectButton, nextButton),
    new ActionRowBuilder<ButtonBuilder>().addComponents(cancelButton),
  ];
}

async function getCurrentSuggestionForReview(
  session: SuggestionReviewSession,
): Promise<{ suggestion: Awaited<ReturnType<typeof getSuggestionById>>; index: number; total: number }> {
  while (session.index < session.suggestionIds.length) {
    const suggestionId = session.suggestionIds[session.index];
    const suggestion = await getSuggestionById(suggestionId);
    if (suggestion) {
      return {
        suggestion,
        index: session.index,
        total: session.suggestionIds.length,
      };
    }
    session.suggestionIds.splice(session.index, 1);
  }

  return {
    suggestion: null,
    index: Math.max(0, session.suggestionIds.length - 1),
    total: session.suggestionIds.length,
  };
}

async function buildSuggestionReviewPayload(
  sessionId: string,
  session: SuggestionReviewSession,
): Promise<{ components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>> }> {
  const current = await getCurrentSuggestionForReview(session);
  const hasSuggestion = Boolean(current.suggestion);
  const hasNext = session.index < session.suggestionIds.length - 1;
  const container = buildSuggestionReviewContainer(
    current.suggestion,
    current.index,
    Math.max(current.total, 1),
    session.totalCount,
  );
  const buttons = buildSuggestionReviewButtons(sessionId, hasSuggestion, hasNext);
  return { components: [container, ...buttons] };
}

function buildSuggestionApproveId(suggestionId: number): string {
  return `${SUGGESTION_APPROVE_PREFIX}:${suggestionId}`;
}

function parseSuggestionApproveId(id: string): number | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== SUGGESTION_APPROVE_PREFIX) {
    return null;
  }
  const suggestionId = Number(parts[1]);
  return Number.isInteger(suggestionId) && suggestionId > 0 ? suggestionId : null;
}

function buildSuggestionLabelSelectId(draftId: string): string {
  return `${SUGGESTION_LABEL_SELECT_PREFIX}:${draftId}`;
}

function buildSuggestionSubmitId(draftId: string): string {
  return `${SUGGESTION_SUBMIT_PREFIX}:${draftId}`;
}

function buildSuggestionCancelId(draftId: string): string {
  return `${SUGGESTION_CANCEL_PREFIX}:${draftId}`;
}

function parseSuggestionDraftId(id: string, prefix: string): string | null {
  const parts = id.split(":");
  if (parts.length !== 2 || parts[0] !== prefix) {
    return null;
  }
  return parts[1] || null;
}

function createSuggestionDraft(
  userId: string,
  title: string,
  details: string,
): string {
  const draftId = `suggestion-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  suggestionDrafts.set(draftId, {
    userId,
    title,
    details,
    labels: [],
    createdAt: Date.now(),
  });
  return draftId;
}

function getSuggestionDraft(draftId: string): SuggestionDraft | null {
  const draft = suggestionDrafts.get(draftId);
  if (!draft) return null;
  if (Date.now() - draft.createdAt > SUGGESTION_DRAFT_TTL_MS) {
    suggestionDrafts.delete(draftId);
    return null;
  }
  return draft;
}

function buildSuggestionDraftComponents(
  draftId: string,
  draft: SuggestionDraft,
): Array<ActionRowBuilder<any>> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildSuggestionLabelSelectId(draftId))
    .setPlaceholder("Select labels (multi-select)")
    .setMinValues(0)
    .setMaxValues(SUGGESTION_LABELS.length)
    .addOptions(
      SUGGESTION_LABELS.map((label) => ({
        label,
        value: label,
        default: draft.labels.includes(label),
      })),
    );
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildSuggestionSubmitId(draftId))
      .setLabel("Submit")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildSuggestionCancelId(draftId))
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary),
  );

  return [selectRow, buttonRow];
}

@Discord()
export class SuggestionCommand {
  @Slash({ description: "Submit a bot suggestion", name: "suggestion" })
  async suggestion(
    @SlashOption({
      description: "Short suggestion title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Details to include in the GitHub issue",
      name: "details",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    details: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const trimmedTitle = sanitizeUserInput(title, { preserveNewlines: false });
    if (!trimmedTitle) {
      await safeReply(interaction, {
        content: "Title cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedDetails = sanitizeUserInput(details, { preserveNewlines: true });
    if (!trimmedDetails) {
      await safeReply(interaction, {
        content: "Details cannot be empty.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const draftId = createSuggestionDraft(
      interaction.user.id,
      trimmedTitle,
      trimmedDetails,
    );
    const draft = getSuggestionDraft(draftId);
    if (!draft) {
      await safeReply(interaction, {
        content: "Unable to start suggestion workflow.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const components = buildSuggestionDraftComponents(draftId, draft);
    await safeReply(interaction, {
      content: "Select labels for the suggestion, then submit.",
      components,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Review pending bot suggestions", name: "suggestion-review" })
  async reviewSuggestions(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(true) });

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isBotDev = interaction.user.id === BOT_DEV_PING_USER_ID;
    if (!isOwner && !isBotDev) {
      await safeReply(interaction, {
        content: "Only the server owner or bot dev can review suggestions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [suggestions, totalCount] = await Promise.all([
      listSuggestions(50),
      countSuggestions(),
    ]);

    if (!suggestions.length) {
      const container = buildSuggestionReviewContainer(null, 0, 0, totalCount);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const suggestionIds = suggestions.map((suggestion) => suggestion.suggestionId).reverse();
    const sessionId = createSuggestionReviewSession(
      interaction.user.id,
      suggestionIds,
      totalCount,
    );
    const session = getSuggestionReviewSession(sessionId);
    if (!session) {
      const container = buildSuggestionReviewContainer(null, 0, 0, totalCount);
      await safeReply(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    const payload = await buildSuggestionReviewPayload(sessionId, session);
    await safeReply(interaction, {
      ...payload,
      flags: buildComponentsV2Flags(true),
    });
  }

  @ButtonComponent({ id: /^suggestion-approve:\d+$/ })
  async approveSuggestion(interaction: ButtonInteraction): Promise<void> {
    const suggestionId = parseSuggestionApproveId(interaction.customId);
    if (!suggestionId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const isBotDev = interaction.user.id === BOT_DEV_PING_USER_ID;
    if (!isOwner && !isBotDev) {
      await safeReply(interaction, {
        content: "Only the server owner or bot dev can approve suggestions.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      await safeReply(interaction, {
        content: "Suggestion not found.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const authorName = suggestion.createdByName ?? "Unknown";
    const description = suggestion.details ?? "No details provided.";
    const body = `${authorName}: ${description}`;
    const labels = suggestion.labels
      ? suggestion.labels.split(",").map((label) => label.trim()).filter(Boolean)
      : [];

    try {
      await createIssue({
        title: suggestion.title,
        body,
        labels,
      });
      await deleteSuggestion(suggestionId);
    } catch (err: any) {
      await safeReply(interaction, {
        content: err?.message ?? "Failed to create GitHub issue.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const approvedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildSuggestionApproveId(suggestionId))
        .setLabel("Approved")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );

    await safeUpdate(interaction, {
      components: [approvedRow],
    });
  }

  @ButtonComponent({ id: /^suggestion-review:.+$/ })
  async reviewSuggestionAction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseSuggestionReviewActionId(interaction.customId);
    if (!parsed) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const session = getSuggestionReviewSession(parsed.sessionId);
    if (!session) {
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          "This suggestion review has expired. Run /suggestion-review again.",
        ),
      );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (session.userId !== interaction.user.id) {
      await safeReply(interaction, {
        content: "This review prompt isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.action === "cancel") {
      suggestionReviewSessions.delete(parsed.sessionId);
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent("Suggestion review closed."),
      );
      await safeUpdate(interaction, {
        components: [container],
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "next") {
      session.index = Math.min(session.index + 1, session.suggestionIds.length);
      session.createdAt = Date.now();
      suggestionReviewSessions.set(parsed.sessionId, session);
      const payload = await buildSuggestionReviewPayload(parsed.sessionId, session);
      await safeUpdate(interaction, {
        ...payload,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "approve") {
      const current = await getCurrentSuggestionForReview(session);
      if (!current.suggestion) {
        const container = buildSuggestionReviewContainer(null, 0, 0, session.totalCount);
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      const authorName = current.suggestion.createdByName ?? "Unknown";
      const description = current.suggestion.details ?? "No details provided.";
      const body = `${authorName}: ${description}`;
      const labels = current.suggestion.labels
        ? current.suggestion.labels.split(",").map((label) => label.trim()).filter(Boolean)
        : [];

      try {
        await createIssue({
          title: current.suggestion.title,
          body,
          labels,
        });
        await deleteSuggestion(current.suggestion.suggestionId);
      } catch (err: any) {
        await safeReply(interaction, {
          content: err?.message ?? "Failed to create GitHub issue.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      session.suggestionIds.splice(session.index, 1);
      session.totalCount = Math.max(0, session.totalCount - 1);
      session.createdAt = Date.now();
      suggestionReviewSessions.set(parsed.sessionId, session);

      const payload = await buildSuggestionReviewPayload(parsed.sessionId, session);
      await safeUpdate(interaction, {
        ...payload,
        flags: buildComponentsV2Flags(true),
      });
      return;
    }

    if (parsed.action === "reject") {
      const current = await getCurrentSuggestionForReview(session);
      if (!current.suggestion) {
        const container = buildSuggestionReviewContainer(null, 0, 0, session.totalCount);
        await safeUpdate(interaction, {
          components: [container],
          flags: buildComponentsV2Flags(true),
        });
        return;
      }

      try {
        await deleteSuggestion(current.suggestion.suggestionId);
      } catch (err: any) {
        await safeReply(interaction, {
          content: err?.message ?? "Failed to reject suggestion.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      session.suggestionIds.splice(session.index, 1);
      session.totalCount = Math.max(0, session.totalCount - 1);
      session.createdAt = Date.now();
      suggestionReviewSessions.set(parsed.sessionId, session);

      const payload = await buildSuggestionReviewPayload(parsed.sessionId, session);
      await safeUpdate(interaction, {
        ...payload,
        flags: buildComponentsV2Flags(true),
      });
    }
  }

  @SelectMenuComponent({ id: /^suggestion-labels:.+$/ })
  async setSuggestionLabels(interaction: StringSelectMenuInteraction): Promise<void> {
    const draftId = parseSuggestionDraftId(interaction.customId, SUGGESTION_LABEL_SELECT_PREFIX);
    if (!draftId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const draft = getSuggestionDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    draft.labels = interaction.values
      .map((value) => SUGGESTION_LABELS.find((label) => label === value))
      .filter((label): label is SuggestionLabel => Boolean(label));
    draft.createdAt = Date.now();
    suggestionDrafts.set(draftId, draft);

    const components = buildSuggestionDraftComponents(draftId, draft);
    await safeUpdate(interaction, {
      content: "Select labels for the suggestion, then submit.",
      components,
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^suggestion-submit:.+$/ })
  async submitSuggestion(interaction: ButtonInteraction): Promise<void> {
    const draftId = parseSuggestionDraftId(interaction.customId, SUGGESTION_SUBMIT_PREFIX);
    if (!draftId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const draft = getSuggestionDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const suggestion = await createSuggestion(
      draft.title,
      draft.details,
      draft.labels.length ? draft.labels.join(", ") : null,
      interaction.user.id,
      interaction.user.username,
    );

    suggestionDrafts.delete(draftId);

    await safeUpdate(interaction, {
      content: `Thanks! Suggestion #${suggestion.suggestionId} submitted.`,
      components: [],
      flags: MessageFlags.Ephemeral,
    });

    try {
      const channel = await interaction.client.channels.fetch(BOT_DEV_CHANNEL_ID);
      if (channel && "send" in channel) {
        await (channel as any).send({
          content:
            `<@${BOT_DEV_PING_USER_ID}> ${interaction.user.username} has submitted a suggestion!`,
        });
      }
    } catch {
      // ignore notification failures
    }
  }

  @ButtonComponent({ id: /^suggestion-cancel:.+$/ })
  async cancelSuggestion(interaction: ButtonInteraction): Promise<void> {
    const draftId = parseSuggestionDraftId(interaction.customId, SUGGESTION_CANCEL_PREFIX);
    if (!draftId) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    const draft = getSuggestionDraft(draftId);
    if (!draft || draft.userId !== interaction.user.id) {
      await safeUpdate(interaction, { components: [] });
      return;
    }

    suggestionDrafts.delete(draftId);
    await safeUpdate(interaction, {
      content: "Suggestion cancelled.",
      components: [],
      flags: MessageFlags.Ephemeral,
    });
  }
}
