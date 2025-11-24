import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import type { ButtonInteraction, CommandInteraction, Message } from "discord.js";
import axios from "axios";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { searchHltb } from "../functions/SearchHltb.js";
import {
  getPresenceHistory,
  setPresence,
  setPresenceFromInteraction,
  type IPresenceHistoryEntry,
} from "../functions/SetPresence.js";
import { AnyRepliable, safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, {
  type IGotmEntry,
  type IGotmGame,
  updateGotmGameFieldInDatabase,
  updateGotmGameImageInDatabase,
  type GotmEditableField,
  insertGotmRoundInDatabase,
  deleteGotmRoundFromDatabase,
  updateGotmVotingResultsInDatabase,
} from "../classes/Gotm.js";
import NrGotm, {
  type INrGotmEntry,
  type INrGotmGame,
  updateNrGotmGameFieldInDatabase,
  updateNrGotmGameImageInDatabase,
  type NrGotmEditableField,
  insertNrGotmRoundInDatabase,
  deleteNrGotmRoundFromDatabase,
  updateNrGotmVotingResultsInDatabase,
} from "../classes/NrGotm.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import {
  buildNominationDeleteViewEmbed,
  announceNominationChange,
} from "../functions/NominationAdminHelpers.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../classes/Nomination.js";
import { getOraclePool } from "../db/oracleClient.js";

type SuperAdminHelpTopicId =
  | "presence"
  | "add-gotm"
  | "edit-gotm"
  | "delete-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "delete-nr-gotm"
  | "delete-gotm-nomination"
  | "delete-nr-gotm-nomination"
  | "set-nextvote"
  | "gotm-data-audit"
  | "nr-gotm-data-audit";

type SuperAdminHelpTopic = {
  id: SuperAdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

const SUPERADMIN_PRESENCE_CHOICES = new Map<string, string[]>();

export const SUPERADMIN_HELP_TOPICS: SuperAdminHelpTopic[] = [
  {
    id: "presence",
    label: "/superadmin presence",
    summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
    syntax: "Syntax: /superadmin presence [text:<string>]",
    parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
  },
  {
    id: "add-gotm",
    label: "/superadmin add-gotm",
    summary: "Interactively add a new GOTM round.",
    syntax: "Syntax: /superadmin add-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest GOTM round.",
  },
  {
    id: "edit-gotm",
    label: "/superadmin edit-gotm",
    summary: "Interactively edit GOTM data for a given round.",
    syntax: "Syntax: /superadmin edit-gotm round:<integer>",
    parameters:
      "round (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "delete-gotm",
    label: "/superadmin delete-gotm",
    summary: "Delete the most recent GOTM round.",
    syntax: "Syntax: /superadmin delete-gotm",
    notes:
      "This removes the latest GOTM round from the database. Use this if a round was added too early or by mistake.",
  },
  {
    id: "add-nr-gotm",
    label: "/superadmin add-nr-gotm",
    summary: "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round.",
    syntax: "Syntax: /superadmin add-nr-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
  },
  {
    id: "edit-nr-gotm",
    label: "/superadmin edit-nr-gotm",
    summary: "Interactively edit NR-GOTM data for a given round.",
    syntax: "Syntax: /superadmin edit-nr-gotm round:<integer>",
    parameters:
      "round (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "delete-nr-gotm",
    label: "/superadmin delete-nr-gotm",
    summary: "Delete the most recent NR-GOTM round.",
    syntax: "Syntax: /superadmin delete-nr-gotm",
    notes:
      "This removes the latest NR-GOTM round from the database. Use this if a round was added too early or by mistake.",
  },
  {
    id: "delete-gotm-nomination",
    label: "/superadmin delete-gotm-nomination",
    summary: "Delete any GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /superadmin delete-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "delete-nr-gotm-nomination",
    label: "/superadmin delete-nr-gotm-nomination",
    summary: "Delete any NR-GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /superadmin delete-nr-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "set-nextvote",
    label: "/superadmin set-nextvote",
    summary: "Set the date of the next GOTM/NR-GOTM vote.",
    syntax: "Syntax: /superadmin set-nextvote date:<date>",
    notes: "Votes are typically held the last Friday of the month.",
  },
  {
    id: "gotm-data-audit",
    label: "/superadmin gotm-data-audit",
    summary: "Audit GOTM data for missing thread IDs, Reddit URLs, and voting result IDs.",
    syntax:
      "Syntax: /superadmin gotm-data-audit [threadid:<boolean>] [redditurl:<boolean>] [votingresults:<boolean>]",
    notes:
      "By default all checks run. Provide specific flags to limit prompts. You can stop or skip prompts during the audit.",
  },
  {
    id: "nr-gotm-data-audit",
    label: "/superadmin nr-gotm-data-audit",
    summary:
      "Audit NR-GOTM data for missing thread IDs, Reddit URLs, and voting result IDs.",
    syntax:
      "Syntax: /superadmin nr-gotm-data-audit [threadid:<boolean>] [redditurl:<boolean>] [votingresults:<boolean>]",
    notes:
      "By default all checks run. Provide specific flags to limit prompts. You can stop or skip prompts during the audit.",
  },
];

function buildSuperAdminHelpButtons(
  activeId?: SuperAdminHelpTopicId,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(SUPERADMIN_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`superadmin-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  return rows;
}

function extractSuperAdminTopicId(customId: string): SuperAdminHelpTopicId | null {
  const prefix = "superadmin-help-";
  const startIndex = customId.indexOf(prefix);
  if (startIndex === -1) return null;

  const raw = customId.slice(startIndex + prefix.length).trim();
  return (SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null) as
    | SuperAdminHelpTopicId
    | null;
}

export function buildSuperAdminHelpEmbed(topic: SuperAdminHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
  
  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function showSuperAdminPresenceHistory(interaction: CommandInteraction): Promise<void> {
  const limit = 5;
  const entries = await getPresenceHistory(limit);

  if (!entries.length) {
    await safeReply(interaction, {
      content: "No presence history found.",
      ephemeral: true,
    });
    return;
  }

  const embed = buildPresenceHistoryEmbed(entries as any);
  const components = buildSuperAdminPresenceButtons(entries.length);

  await safeReply(interaction, {
    embeds: [embed],
    components,
    ephemeral: true,
  });

  try {
    const msg = (await interaction.fetchReply()) as Message | undefined;
    if (msg?.id) {
      SUPERADMIN_PRESENCE_CHOICES.set(
        msg.id,
        entries.map((e: any) => e.activityName ?? ""),
      );
    }
  } catch {
    // ignore
  }
}

type AuditField = "threadId" | "redditUrl" | "votingResults" | "image";

type AuditPromptResult =
  | { action: "value"; value: string | null }
  | { action: "skip" }
  | { action: "no-value" }
  | "stop";
type AuditImageResult =
  | { action: "store"; buffer: Buffer; mimeType: string | null }
  | { action: "skip" }
  | { action: "no-value" }
  | "stop";

type AuditPromptResponse = {
  result: AuditPromptResult;
  promptMessage: Message | null;
};

export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";
const THREAD_ID_MAX_LENGTH = 50;

function isAuditNoValue(value: string | null | undefined): boolean {
  return value === AUDIT_NO_VALUE_SENTINEL;
}

function isAuditFieldMissing(value: string | null | undefined): boolean {
  return !value && !isAuditNoValue(value);
}

function isAuditImageMissing(
  imageBlob: Buffer | null | undefined,
  imageMimeType: string | null | undefined,
): boolean {
  return !imageBlob && !isAuditNoValue(imageMimeType);
}

function displayAuditValue(value: string | null | undefined): string | null {
  if (isAuditNoValue(value)) return null;
  return value ?? null;
}

const MONTHS_LOWER = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

function isAfterRedditCutoff(monthYear: string): boolean {
  const match = monthYear?.match(/([A-Za-z]+)\s+(\d{4})/);
  if (!match) return false;

  const monthName = match[1]?.toLowerCase() ?? "";
  const year = Number(match[2]);
  const monthIndex = MONTHS_LOWER.indexOf(monthName as any);

  if (!Number.isFinite(year) || monthIndex === -1) return false;
  if (year > 2021) return true;
  if (year < 2021) return false;
  return monthIndex > 4; // after May 2021
}

function buildAuditPromptEmbed(info: {
  auditLabel: string;
  roundLabel: string;
  gameTitle?: string | null;
  field: AuditField;
  winners: string[];
  rawEntry: any;
  gameIndex: number | null;
}): EmbedBuilder {
  const lines: string[] = [];
  lines.push(info.roundLabel);
  lines.push("");
  lines.push("Current round data:");
  lines.push("```json");
  try {
    if (info.gameIndex !== null && Array.isArray(info.rawEntry?.gameOfTheMonth)) {
      const game = info.rawEntry.gameOfTheMonth[info.gameIndex];
      lines.push(JSON.stringify(game ?? info.rawEntry, null, 2));
    } else {
      lines.push(JSON.stringify(info.rawEntry, null, 2));
    }
  } catch {
    lines.push("(unable to render data)");
  }
  lines.push("```");
  lines.push("");
  if (info.field === "threadId") {
    lines.push("**Missing thread ID**. Provide a webhook/thread/channel ID for this game's discussion.");
  } else if (info.field === "redditUrl") {
    lines.push("**Missing Reddit URL**. Provide a link to the Reddit thread for this game.");
  } else {
    lines.push("**Missing voting results message ID**. Provide the message ID that contains voting results.");
  }
  lines.push("");
  lines.push("Click Skip to leave it empty, Stop Audit to end, No Value to skip forever, or type a value (none/null to clear).");
  lines.push("");
  lines.push("Provide the new value below:");

  return new EmbedBuilder()
    .setTitle(`${info.auditLabel} Data Audit`)
    .setDescription(lines.join("\n"));
}

type ImageBufferResult = { buffer: Buffer; mimeType: string | null };

async function downloadImageBuffer(url: string): Promise<ImageBufferResult> {
  const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const mime = resp.headers?.["content-type"] ?? null;
  return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
}

type ThreadImageResult = { buffer: Buffer; mimeType: string | null; url: string };

async function resolveThreadImageBuffer(
  client: any,
  threadId: string,
): Promise<ThreadImageResult | null> {
  try {
    const channel = await client.channels.fetch(threadId);
    const anyThread = channel as any;
    if (!anyThread || typeof anyThread.fetchStarterMessage !== "function") return null;
    const starter = await anyThread.fetchStarterMessage().catch(() => null);
    if (!starter) return null;

    for (const att of starter.attachments?.values?.() ?? []) {
      const anyAtt: any = att as any;
      const nameLc = (anyAtt.name ?? "").toLowerCase();
      const ctype = (anyAtt.contentType ?? "").toLowerCase();
      if (
        ctype.startsWith("image/") ||
        /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/.test(nameLc) ||
        anyAtt.width
      ) {
        const url = anyAtt.url ?? anyAtt.proxyURL;
        if (!url) continue;
        const { buffer, mimeType } = await downloadImageBuffer(url);
        return { buffer, mimeType, url };
      }
    }

    for (const emb of starter.embeds ?? []) {
      const anyEmb: any = emb as any;
      const imgUrl: string | undefined =
        emb.image?.url || anyEmb?.image?.proxyURL || anyEmb?.image?.proxy_url;
      const thumbUrl: string | undefined =
        emb.thumbnail?.url ||
        anyEmb?.thumbnail?.proxyURL ||
        anyEmb?.thumbnail?.proxy_url;
      const chosen = imgUrl || thumbUrl;
      if (chosen) {
        const { buffer, mimeType } = await downloadImageBuffer(chosen);
        return { buffer, mimeType, url: chosen };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function resolveHltbImageBuffer(gameTitle: string): Promise<ThreadImageResult | null> {
  try {
    const result = await searchHltb(gameTitle);
    let url = result?.imageUrl;
    if (!url) return null;
    if (url.startsWith("//")) {
      url = "https:" + url;
    } else if (url.startsWith("/")) {
      url = "https://howlongtobeat.com" + url;
    }
    if (!url) return null;
    const { buffer, mimeType } = await downloadImageBuffer(url);
    return { buffer, mimeType, url };
  } catch {
    return null;
  }
}

function buildImageAttachment(
  buffer: Buffer,
  mimeType: string | null,
  label: string,
): AttachmentBuilder {
  const ext = (() => {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/bmp": "bmp",
      "image/tiff": "tiff",
    };
    if (!mimeType) return "png";
    return map[mimeType.toLowerCase()] ?? "png";
  })();
  return new AttachmentBuilder(buffer, {
    name: `${label}.${ext}`,
  });
}

async function promptForAuditValue(
  interaction: CommandInteraction,
  opts: {
    auditLabel: string;
    tokenPrefix: string;
    round: number;
    roundLabel: string;
    gameIndex: number | null;
    gameTitle: string | null;
    field: AuditField;
    winners: string[];
    rawEntry: any;
    promptMessage?: Message | null;
    useEditReply?: boolean;
  },
): Promise<AuditPromptResponse> {
  const promptEmbed = buildAuditPromptEmbed({
    auditLabel: opts.auditLabel,
    roundLabel: opts.roundLabel,
    gameTitle: opts.gameTitle,
    field: opts.field,
    winners: opts.winners,
    rawEntry: opts.rawEntry,
    gameIndex: opts.gameIndex,
  });

  const token = `${opts.tokenPrefix}-audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const stopPrefix = `${opts.tokenPrefix}-audit-stop`;
  const skipPrefix = `${opts.tokenPrefix}-audit-skip`;
  const noValuePrefix = `${opts.tokenPrefix}-audit-novalue`;

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${stopPrefix}-${token}`)
      .setLabel("Stop Audit")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${noValuePrefix}-${token}`)
      .setLabel("No Value")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${skipPrefix}-${token}`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Danger),
  );

  let promptMessage = opts.promptMessage ?? null;
  const payload = {
    embeds: [promptEmbed],
    components: [buttonRow],
    content: undefined as string | undefined,
  };

  const editPrompt = async (msg: Message, data: any): Promise<Message | null> => {
    try {
      return await msg.edit(data);
    } catch (err: any) {
      if (err?.code === 10008 || err?.code === 50027) {
        return null;
      }
      throw err;
    }
  };

  const tryEditReply = async (): Promise<Message | null> => {
    try {
      const edited = await (interaction as any).editReply(payload);
      return edited as Message;
    } catch (err: any) {
      if (err?.code === 10008 || err?.code === 50027) return null;
      throw err;
    }
  };

  if (opts.useEditReply) {
    promptMessage = await tryEditReply();
  } else if (promptMessage) {
    const edited = await editPrompt(promptMessage, payload);
    promptMessage = edited ?? null;
  }

  if (!promptMessage) {
    // Fallback: create a new followup
    promptMessage = await interaction.followUp({
      ...payload,
      ephemeral: true,
    });
  }

  const buttonPromise = promptMessage
    .awaitMessageComponent({
      filter: (i) => {
        const cid = i.customId ?? "";
        return i.user?.id === interaction.user.id && cid.endsWith(token);
      },
      time: 120_000,
    })
    .then(async (i) => {
      const cid = i.customId ?? "";
      if (!i.deferred && !i.replied) {
        await i.deferUpdate().catch(() => {});
      }
      if (cid.startsWith(stopPrefix)) return "stop" as const;
      if (cid.startsWith(noValuePrefix)) return { action: "no-value" } as AuditPromptResult;
      return { action: "skip" } as AuditPromptResult;
    })
    .catch(() => null);

  const channel: any = interaction.channel;
  const textPromise = channel?.awaitMessages
    ? channel
        .awaitMessages({
          filter: (m: any) => m.author?.id === interaction.user.id,
          max: 1,
          time: 120_000,
        })
        .then(async (collected: any) => {
          const first = collected?.first?.();
          const content: string | undefined = first?.content;
          if (!content) return null;
          const trimmed = String(content).trim();
          const lower = trimmed.toLowerCase();
          try {
            await first.delete().catch(() => {});
          } catch {
            // ignore delete failures
          }
          if (lower === "stop") return "stop" as const;
          if (lower === "none" || lower === "null" || lower === "skip") return { action: "skip" } as const;
          if (lower === "never" || lower === "no value" || lower === "no-value") {
            return { action: "no-value" } as const;
          }
          return { action: "value", value: trimmed } as AuditPromptResult;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const result = await Promise.race([buttonPromise, textPromise]);

  if (opts.useEditReply && promptMessage) {
    await (interaction as any).editReply({ components: [] });
  } else {
    await editPrompt(promptMessage, { components: [] });
  }

  return {
    result: result ?? { action: "skip" },
    promptMessage,
  };
}

async function promptForAuditImage(
  interaction: CommandInteraction,
  opts: {
    auditLabel: string;
    tokenPrefix: string;
    round: number;
    roundLabel: string;
    gameIndex: number;
    gameTitle: string;
    threadId: string | null;
    promptMessage?: Message | null;
    useEditReply?: boolean;
  },
): Promise<{ result: AuditImageResult; promptMessage: Message | null }> {
  const token = `${opts.tokenPrefix}-auditimg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const stopPrefix = `${opts.tokenPrefix}-auditimg-stop`;
  const skipPrefix = `${opts.tokenPrefix}-auditimg-skip`;
  const noValuePrefix = `${opts.tokenPrefix}-auditimg-novalue`;
  const useThreadPrefix = `${opts.tokenPrefix}-auditimg-thread`;
  const useHltbPrefix = `${opts.tokenPrefix}-auditimg-hltb`;

  const threadCandidate = opts.threadId
    ? await resolveThreadImageBuffer(interaction.client, opts.threadId).catch(() => null)
    : null;
  const hltbCandidate = await resolveHltbImageBuffer(opts.gameTitle).catch(() => null);

  const files: AttachmentBuilder[] = [];
  const embed = new EmbedBuilder()
    .setTitle(`${opts.auditLabel} Image Audit`)
    .setDescription(
      [
        opts.roundLabel,
        `Game: ${opts.gameTitle}`,
        "",
        "Choose an image source below, or paste/upload an image in chat.",
        "Buttons:",
        "- Use Thread Image: first image from the discussion thread (if available).",
        "- Use HLTB Image: cover art from /coverart search (if available).",
        "- Skip: leave image empty for now.",
        "- No Value: mark as intentionally missing (won't be asked again).",
        "- Stop Audit: end the audit.",
      ].join("\n"),
    );

  if (threadCandidate) {
    const att = buildImageAttachment(threadCandidate.buffer, threadCandidate.mimeType, "thread-image");
    files.push(att);
    embed.addFields({ name: "Thread Image", value: `attachment://${att.name}` });
  }

  if (hltbCandidate) {
    const att = buildImageAttachment(hltbCandidate.buffer, hltbCandidate.mimeType, "hltb-image");
    files.push(att);
    embed.addFields({ name: "HLTB Image", value: `attachment://${att.name}` });
  }

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${stopPrefix}-${token}`)
      .setLabel("Stop Audit")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${noValuePrefix}-${token}`)
      .setLabel("No Value")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${skipPrefix}-${token}`)
      .setLabel("Skip")
      .setStyle(ButtonStyle.Danger),
  );

  const chooseRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${useThreadPrefix}-${token}`)
      .setLabel("Use Thread Image")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!threadCandidate),
    new ButtonBuilder()
      .setCustomId(`${useHltbPrefix}-${token}`)
      .setLabel("Use HLTB Image")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hltbCandidate),
  );

  let promptMessage = opts.promptMessage ?? null;
  const payload = {
    embeds: [embed],
    components: [buttonRow, chooseRow],
    files: files.length ? files : undefined,
    content: undefined as string | undefined,
  };

  const editPrompt = async (msg: Message, data: any): Promise<Message | null> => {
    try {
      return await msg.edit(data);
    } catch (err: any) {
      if (err?.code === 10008 || err?.code === 50027) {
        return null;
      }
      throw err;
    }
  };

  const tryEditReply = async (): Promise<Message | null> => {
    try {
      const edited = await (interaction as any).editReply(payload);
      return edited as Message;
    } catch (err: any) {
      if (err?.code === 10008 || err?.code === 50027) return null;
      throw err;
    }
  };

  if (opts.useEditReply) {
    promptMessage = await tryEditReply();
  } else if (promptMessage) {
    const edited = await editPrompt(promptMessage, payload);
    promptMessage = edited ?? null;
  }

  if (!promptMessage) {
    promptMessage = await interaction.followUp({
      ...payload,
      ephemeral: true,
    });
  }

  const buttonPromise = promptMessage
    .awaitMessageComponent({
      filter: (i) => {
        const cid = i.customId ?? "";
        return i.user?.id === interaction.user.id && cid.endsWith(token);
      },
      time: 120_000,
    })
    .then(async (i) => {
      const cid = i.customId ?? "";
      if (!i.deferred && !i.replied) {
        await i.deferUpdate().catch(() => {});
      }
      if (cid.startsWith(stopPrefix)) return "stop" as const;
      if (cid.startsWith(noValuePrefix)) return { action: "no-value" } as AuditImageResult;
      if (cid.startsWith(skipPrefix)) return { action: "skip" } as AuditImageResult;
      if (cid.startsWith(useThreadPrefix) && threadCandidate) {
        return { action: "store", buffer: threadCandidate.buffer, mimeType: threadCandidate.mimeType } as AuditImageResult;
      }
      if (cid.startsWith(useHltbPrefix) && hltbCandidate) {
        return { action: "store", buffer: hltbCandidate.buffer, mimeType: hltbCandidate.mimeType } as AuditImageResult;
      }
      return { action: "skip" } as AuditImageResult;
    })
    .catch(() => null);

  const channel: any = interaction.channel;
  const textPromise = channel?.awaitMessages
    ? channel
        .awaitMessages({
          filter: (m: any) => m.author?.id === interaction.user.id,
          max: 1,
          time: 120_000,
        })
        .then(async (collected: any) => {
          const first = collected?.first?.();
          if (!first) return null;
          const attachment =
            first.attachments?.find?.(
              (a: any) =>
                (a.contentType ?? "").startsWith("image/") ||
                /\.(png|jpg|jpeg|gif|webp|bmp|tiff)$/i.test((a.name ?? "").toLowerCase()),
            ) ?? null;
          if (!attachment) return null;
          const url = (attachment as any).url ?? (attachment as any).proxyURL;
          if (!url) return null;
          const { buffer, mimeType } = await downloadImageBuffer(url);
          try {
            await first.delete().catch(() => {});
          } catch {
            // ignore
          }
          return { action: "store", buffer, mimeType } as AuditImageResult;
        })
        .catch(() => null)
    : Promise.resolve(null);

  const result = await Promise.race([buttonPromise, textPromise]);

  if (opts.useEditReply && promptMessage) {
    await (interaction as any).editReply({ components: [] });
  } else {
    await editPrompt(promptMessage, { components: [] });
  }

  return {
    result: result ?? { action: "skip" },
    promptMessage,
  };
}

@Discord()
@SlashGroup({ description: "Server Owner Commands", name: "superadmin" })
@SlashGroup("superadmin")
export class SuperAdmin {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be? Leave empty to browse history.",
      name: "text",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    text: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);

    if (!okToUseCommand) return;

    if (text && text.trim()) {
      await setPresence(interaction, text.trim());
      await safeReply(interaction, {
        content: `I'm now playing: ${text.trim()}!`,
        ephemeral: true,
      });
      return;
    }

    await showSuperAdminPresenceHistory(interaction);
  }

  @ButtonComponent({ id: /^superadmin-presence-restore-\d+$/ })
  async handleSuperAdminPresenceRestore(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    const entries = messageId ? SUPERADMIN_PRESENCE_CHOICES.get(messageId) : undefined;
    const idx = Number(interaction.customId.replace("superadmin-presence-restore-", ""));

    if (!entries || !Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
      await safeUpdate(interaction, {
        content: "Sorry, I couldn't find that presence entry. Please run `/superadmin presence` again.",
        components: [],
      });
      if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
      return;
    }

    const presenceText = entries[idx];

    try {
      await setPresenceFromInteraction(interaction, presenceText);
      await safeUpdate(interaction, {
        content: `Restored presence to: ${presenceText}`,
        components: [],
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeUpdate(interaction, {
        content: `Failed to restore presence: ${msg}`,
        components: [],
      });
    } finally {
      if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
    }
  }

  @ButtonComponent({ id: "superadmin-presence-cancel" })
  async handleSuperAdminPresenceCancel(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);

    await safeUpdate(interaction, {
      content: "No presence was restored.",
      components: [],
    });
  }

  @ButtonComponent({ id: /^(gotm|nr-gotm)-audit(img)?-(stop|skip|novalue).*-/ })
  async handleAuditButtons(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }
  }

  @Slash({ description: "Scan guild members and upsert into RPG_CLUB_USERS", name: "memberscan" })
  async memberScan(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, { content: "This command must be run in a guild.", ephemeral: true });
      return;
    }

    const roleMap = {
      admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    };

    await safeReply(interaction, { content: "Fetching all guild members... this may take a moment.", ephemeral: true });

    const members = await guild.members.fetch();
    const pool = getOraclePool();
    let connection = await pool.getConnection();
    const isRecoverableOracleError = (err: any): boolean => {
      const code = err?.code ?? err?.errorNum;
      const msg = err?.message ?? "";
      return (
        code === "NJS-500" ||
        code === "NJS-503" ||
        code === "ORA-03138" ||
        code === "ORA-03146" ||
        /DPI-1010|ORA-03135|end-of-file on communication channel/i.test(msg)
      );
    };
    const reopenConnection = async () => {
      try {
        await connection?.close();
      } catch {
        // ignore
      }
      connection = await pool.getConnection();
    };

    let successCount = 0;
    let failCount = 0;

    const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    try {
      for (const member of members.values()) {
        const user = member.user;

        // Build avatar blob (throttled per-user)
        let avatarBlob: Buffer | null = null;
        const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
        if (avatarUrl) {
          try {
            const { buffer } = await downloadImageBuffer(avatarUrl);
            avatarBlob = buffer;
          } catch {
            // ignore avatar fetch failures
          }
        }

        const hasRole = (id?: string | null): number => {
          if (!id) return 0;
          return member.roles.cache.has(id) ? 1 : 0;
        };
        const adminFlag =
          hasRole(roleMap.admin) || member.permissions.has("Administrator") ? 1 : 0;
        const moderatorFlag =
          hasRole(roleMap.mod) || member.permissions.has("ManageMessages") ? 1 : 0;
        const regularFlag = hasRole(roleMap.regular);
        const memberFlag = hasRole(roleMap.member);
        const newcomerFlag = hasRole(roleMap.newcomer);

        const execUpsert = async (avatarData: Buffer | null) => {
          // Try update first
          const update = await connection.execute(
            `UPDATE RPG_CLUB_USERS
                SET IS_BOT = :isBot,
                    USERNAME = :username,
                    GLOBAL_NAME = :globalName,
                    AVATAR_BLOB = :avatarBlob,
                    SERVER_JOINED_AT = :joinedAt,
                    LAST_SEEN_AT = :lastSeenAt,
                    LAST_FETCHED_AT = SYSTIMESTAMP,
                    ROLE_ADMIN = :roleAdmin,
                    ROLE_MODERATOR = :roleModerator,
                    ROLE_REGULAR = :roleRegular,
                    ROLE_MEMBER = :roleMember,
                    ROLE_NEWCOMER = :roleNewcomer,
                    UPDATED_AT = SYSTIMESTAMP
              WHERE USER_ID = :userId`,
            {
              userId: user.id,
              isBot: user.bot ? 1 : 0,
              username: user.username,
              globalName: (user as any).globalName ?? null,
              avatarBlob: avatarData,
              joinedAt: member.joinedAt ?? null,
              lastSeenAt: null,
              roleAdmin: adminFlag,
              roleModerator: moderatorFlag,
              roleRegular: regularFlag,
              roleMember: memberFlag,
              roleNewcomer: newcomerFlag,
            },
            { autoCommit: true },
          );

          const updated = update.rowsAffected ?? 0;
          if (updated > 0) return;

          // Insert if no existing row
          try {
            await connection.execute(
              `INSERT INTO RPG_CLUB_USERS (
                 USER_ID, IS_BOT, USERNAME, GLOBAL_NAME, AVATAR_BLOB,
                 SERVER_JOINED_AT, LAST_SEEN_AT, LAST_FETCHED_AT,
                 ROLE_ADMIN, ROLE_MODERATOR, ROLE_REGULAR, ROLE_MEMBER, ROLE_NEWCOMER,
                 CREATED_AT, UPDATED_AT
               ) VALUES (
                 :userId, :isBot, :username, :globalName, :avatarBlob,
                 :joinedAt, :lastSeenAt, SYSTIMESTAMP,
                 :roleAdmin, :roleModerator, :roleRegular, :roleMember, :roleNewcomer,
                 SYSTIMESTAMP, SYSTIMESTAMP
               )`,
              {
                userId: user.id,
                isBot: user.bot ? 1 : 0,
                username: user.username,
                globalName: (user as any).globalName ?? null,
                avatarBlob: avatarData,
                joinedAt: member.joinedAt ?? null,
                lastSeenAt: null,
                roleAdmin: adminFlag,
                roleModerator: moderatorFlag,
                roleRegular: regularFlag,
                roleMember: memberFlag,
                roleNewcomer: newcomerFlag,
              },
              { autoCommit: true },
            );
          } catch (insErr: any) {
            const code = insErr?.code ?? insErr?.errorNum;
            if (code === "ORA-00001") {
              // Row existed; fallback to update
              await connection.execute(
                `UPDATE RPG_CLUB_USERS
                    SET IS_BOT = :isBot,
                        USERNAME = :username,
                        GLOBAL_NAME = :globalName,
                        AVATAR_BLOB = :avatarBlob,
                        SERVER_JOINED_AT = :joinedAt,
                        LAST_SEEN_AT = :lastSeenAt,
                        LAST_FETCHED_AT = SYSTIMESTAMP,
                        ROLE_ADMIN = :roleAdmin,
                        ROLE_MODERATOR = :roleModerator,
                        ROLE_REGULAR = :roleRegular,
                        ROLE_MEMBER = :roleMember,
                        ROLE_NEWCOMER = :roleNewcomer,
                        UPDATED_AT = SYSTIMESTAMP
                  WHERE USER_ID = :userId`,
                {
                  userId: user.id,
                  isBot: user.bot ? 1 : 0,
                  username: user.username,
                  globalName: (user as any).globalName ?? null,
                  avatarBlob: avatarData,
                  joinedAt: member.joinedAt ?? null,
                  lastSeenAt: null,
                  roleAdmin: hasRole(roleMap.admin),
                  roleModerator: hasRole(roleMap.mod),
                  roleRegular: hasRole(roleMap.regular),
                  roleMember: hasRole(roleMap.member),
                  roleNewcomer: hasRole(roleMap.newcomer),
                },
                { autoCommit: true },
              );
            } else {
              throw insErr;
            }
          }
        };

        try {
          await execUpsert(avatarBlob);
          successCount++;
        } catch (err) {
          const code = (err as any)?.code ?? (err as any)?.errorNum;

          if (code === "ORA-03146") {
            try {
              await execUpsert(null);
              successCount++;
              continue;
            } catch (retryErr) {
              failCount++;
              console.error(`Failed to upsert user ${user.id} after stripping avatar`, retryErr);
              continue;
            }
          }

          if (isRecoverableOracleError(err)) {
            await reopenConnection();
            try {
              await execUpsert(avatarBlob);
              successCount++;
              continue;
            } catch (retryErr) {
              failCount++;
              console.error(`Failed to upsert user ${user.id} after retry`, retryErr);
            }
          } else {
            failCount++;
            console.error(`Failed to upsert user ${user.id}`, err);
          }
        }

        // throttle: one user per second
        await delay(1000);

      }
    } finally {
      await connection.close();
    }

    await safeReply(interaction, {
      content: `Member scan complete. Upserts succeeded: ${successCount}. Failed: ${failCount}.`,
      ephemeral: true,
    });
  }

  @Slash({
    description: "Audit GOTM data for missing fields",
    name: "gotm-data-audit",
  })
  async gotmDataAudit(
    @SlashOption({
      description: "Ask only about missing thread IDs",
      name: "threadid",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    threadIdFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing Reddit URLs",
      name: "redditurl",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    redditUrlFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing voting result message IDs",
      name: "votingresults",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    votingResultsFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing images",
      name: "image",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    imageFlag: boolean | undefined,
    @SlashOption({
      description: "Order to audit rounds (asc or desc, default desc)",
      name: "order",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    order: string | undefined,
    @SlashOption({
      description: "If true, show prompts in-channel (not ephemeral)",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const checks: Record<AuditField, boolean> = {
      threadId: Boolean(threadIdFlag),
      redditUrl: Boolean(redditUrlFlag),
      votingResults: Boolean(votingResultsFlag),
      image: Boolean(imageFlag),
    };

    if (!checks.threadId && !checks.redditUrl && !checks.votingResults && !checks.image) {
      checks.threadId = true;
      checks.redditUrl = true;
      checks.votingResults = true;
      checks.image = true;
    }

    const dir = (order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const entries = Gotm.all()
      .slice()
      .sort((a, b) => (dir === "asc" ? a.round - b.round : b.round - a.round));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "No GOTM data available to audit.",
        ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content:
        "Starting GOTM data audit. Click Stop Audit at any prompt to end early. Click Skip or type none/null to leave a field empty.",
      ephemeral,
    });

    let stopped = false;
    let promptMessage: Message | null = null;
    let useEditReply = false;
    try {
      promptMessage = (await interaction.fetchReply()) as Message | null;
      useEditReply = !!promptMessage;
    } catch {
      // ignore fetch failures; prompt creation handled below
    }

    for (const entry of entries) {
      if (stopped) break;

      const roundLabel = `Round ${entry.round} (${entry.monthYear})`;
      const skipRedditAudit = isAfterRedditCutoff(entry.monthYear);

      for (let i = 0; i < entry.gameOfTheMonth.length; i++) {
        const game = entry.gameOfTheMonth[i];
        const winners = entry.gameOfTheMonth.map((g) => g.title);
        if (checks.threadId && isAuditFieldMissing(game.threadId)) {
          const res = await promptForAuditValue(interaction, {
            auditLabel: "GOTM",
            tokenPrefix: "gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            field: "threadId",
            winners,
            rawEntry: entry,
            promptMessage,
            useEditReply,
          });
          promptMessage = res.promptMessage;
        if (res.result === "stop") {
          stopped = true;
          break;
        }
        if (res.result && res.result.action === "value") {
          const val = res.result.value ?? "";
          if (val.length > THREAD_ID_MAX_LENGTH) {
            await safeReply(interaction, {
              content: `Thread ID is too long (${val.length}). Max allowed is ${THREAD_ID_MAX_LENGTH}. Please provide the ID (not a URL).`,
            });
            continue;
          }
          await updateGotmGameFieldInDatabase(entry.round, i, "threadId", res.result.value);
          Gotm.updateThreadIdByRound(entry.round, res.result.value, i);
        } else if (res.result && res.result.action === "no-value") {
          await updateGotmGameFieldInDatabase(entry.round, i, "threadId", AUDIT_NO_VALUE_SENTINEL);
          Gotm.updateThreadIdByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
        }
      }
        if (stopped) break;

        if (checks.redditUrl && !skipRedditAudit && isAuditFieldMissing(game.redditUrl)) {
          const res = await promptForAuditValue(interaction, {
            auditLabel: "GOTM",
            tokenPrefix: "gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            field: "redditUrl",
            winners,
            rawEntry: entry,
            promptMessage,
            useEditReply,
          });
          promptMessage = res.promptMessage;
          if (res.result === "stop") {
            stopped = true;
            break;
          }
          if (res.result && res.result.action === "value") {
            await updateGotmGameFieldInDatabase(entry.round, i, "redditUrl", res.result.value);
            Gotm.updateRedditUrlByRound(entry.round, res.result.value, i);
          } else if (res.result && res.result.action === "no-value") {
            await updateGotmGameFieldInDatabase(entry.round, i, "redditUrl", AUDIT_NO_VALUE_SENTINEL);
            Gotm.updateRedditUrlByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
          }
        }

        if (stopped) break;

        if (
          checks.image &&
          isAuditImageMissing(game.imageBlob as any, (game as any).imageMimeType)
        ) {
          const resImg = await promptForAuditImage(interaction, {
            auditLabel: "GOTM",
            tokenPrefix: "gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            threadId: displayAuditValue(game.threadId),
            promptMessage,
            useEditReply,
          });
          promptMessage = resImg.promptMessage;
          if (resImg.result === "stop") {
            stopped = true;
            break;
          }
          if (resImg.result && resImg.result.action === "store") {
            await updateGotmGameImageInDatabase(
              entry.round,
              i,
              resImg.result.buffer,
              resImg.result.mimeType,
            );
            Gotm.updateImageByRound(entry.round, resImg.result.buffer, resImg.result.mimeType, i);
          } else if (resImg.result && resImg.result.action === "no-value") {
            await updateGotmGameImageInDatabase(entry.round, i, null, AUDIT_NO_VALUE_SENTINEL);
            Gotm.updateImageByRound(entry.round, null, AUDIT_NO_VALUE_SENTINEL, i);
          }
        }
      }

      if (stopped) break;

      if (checks.votingResults && isAuditFieldMissing(entry.votingResultsMessageId)) {
        const res = await promptForAuditValue(interaction, {
          auditLabel: "GOTM",
          tokenPrefix: "gotm",
          round: entry.round,
          roundLabel,
          gameIndex: null,
          gameTitle: null,
          field: "votingResults",
          winners: entry.gameOfTheMonth.map((g) => g.title),
          rawEntry: entry,
          promptMessage,
          useEditReply,
        });
        promptMessage = res.promptMessage;
        if (res.result === "stop") {
          stopped = true;
          break;
        }
        if (res.result && res.result.action === "value") {
          await updateGotmVotingResultsInDatabase(entry.round, res.result.value);
          Gotm.updateVotingResultsByRound(entry.round, res.result.value);
        } else if (res.result && res.result.action === "no-value") {
          await updateGotmVotingResultsInDatabase(entry.round, AUDIT_NO_VALUE_SENTINEL);
          Gotm.updateVotingResultsByRound(entry.round, AUDIT_NO_VALUE_SENTINEL);
        }
      }
    }

    if (promptMessage) {
      const finalContent = stopped ? "Audit stopped." : "Audit completed.";
      try {
        const fetchedReply = await interaction.fetchReply().catch(() => null);
        const canEdit =
          (interaction as any).editReply &&
          promptMessage &&
          promptMessage.id === fetchedReply?.id;

        if (canEdit) {
          await (interaction as any).editReply({
            content: finalContent,
            embeds: [],
            components: [],
          });
        } else {
          await promptMessage.edit({ content: finalContent, embeds: [], components: [] });
        }
      } catch (err: any) {
        if (err?.code !== 10008 && err?.code !== 50027) throw err;
        await safeReply(interaction, { content: finalContent });
      }
    } else {
      if (stopped) {
        await safeReply(interaction, { content: "Audit stopped." });
      } else {
        await safeReply(interaction, { content: "Audit completed." });
      }
    }
  }

  @Slash({
    description: "Audit NR-GOTM data for missing fields",
    name: "nr-gotm-data-audit",
  })
  async nrGotmDataAudit(
    @SlashOption({
      description: "Ask only about missing thread IDs",
      name: "threadid",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    threadIdFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing Reddit URLs",
      name: "redditurl",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    redditUrlFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing voting result message IDs",
      name: "votingresults",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    votingResultsFlag: boolean | undefined,
    @SlashOption({
      description: "Ask only about missing images",
      name: "image",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    imageFlag: boolean | undefined,
    @SlashOption({
      description: "Order to audit rounds (asc or desc, default desc)",
      name: "order",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    order: string | undefined,
    @SlashOption({
      description: "If true, show prompts in-channel (not ephemeral)",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const checks: Record<AuditField, boolean> = {
      threadId: Boolean(threadIdFlag),
      redditUrl: Boolean(redditUrlFlag),
      votingResults: Boolean(votingResultsFlag),
      image: Boolean(imageFlag),
    };

    if (!checks.threadId && !checks.redditUrl && !checks.votingResults && !checks.image) {
      checks.threadId = true;
      checks.redditUrl = true;
      checks.votingResults = true;
      checks.image = true;
    }

    const dir = (order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const entries = NrGotm.all()
      .slice()
      .sort((a, b) => (dir === "asc" ? a.round - b.round : b.round - a.round));
    if (!entries.length) {
      await safeReply(interaction, {
        content: "No NR-GOTM data available to audit.",
        ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content:
        "Starting NR-GOTM data audit. Click Stop Audit at any prompt to end early. Click Skip or type none/null to leave a field empty.",
      ephemeral,
    });

    let stopped = false;
    let promptMessage: Message | null = null;
    let useEditReply = false;
    try {
      promptMessage = (await interaction.fetchReply()) as Message | null;
      useEditReply = !!promptMessage;
    } catch {
      // ignore
    }

    for (const entry of entries) {
      if (stopped) break;

      const roundLabel = `Round ${entry.round} (${entry.monthYear})`;
      const skipRedditAudit = isAfterRedditCutoff(entry.monthYear);

      for (let i = 0; i < entry.gameOfTheMonth.length; i++) {
        const game = entry.gameOfTheMonth[i];
        const winners = entry.gameOfTheMonth.map((g) => g.title);

        if (checks.threadId && isAuditFieldMissing(game.threadId)) {
          const res = await promptForAuditValue(interaction, {
            auditLabel: "NR-GOTM",
            tokenPrefix: "nr-gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            field: "threadId",
            winners,
            rawEntry: entry,
            promptMessage,
            useEditReply,
          });
          promptMessage = res.promptMessage;
        if (res.result === "stop") {
          stopped = true;
          break;
        }
        if (res.result && res.result.action === "value") {
          const val = res.result.value ?? "";
          if (val.length > THREAD_ID_MAX_LENGTH) {
            await safeReply(interaction, {
              content: `Thread ID is too long (${val.length}). Max allowed is ${THREAD_ID_MAX_LENGTH}. Please provide the ID (not a URL).`,
            });
            continue;
          }
          await updateNrGotmGameFieldInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              field: "threadId",
              value: res.result.value,
            });
          NrGotm.updateThreadIdByRound(entry.round, res.result.value, i);
        } else if (res.result && res.result.action === "no-value") {
          await updateNrGotmGameFieldInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              field: "threadId",
              value: AUDIT_NO_VALUE_SENTINEL,
            });
          NrGotm.updateThreadIdByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
        }
        }
        if (stopped) break;

        if (checks.redditUrl && !skipRedditAudit && isAuditFieldMissing(game.redditUrl)) {
          const res = await promptForAuditValue(interaction, {
            auditLabel: "NR-GOTM",
            tokenPrefix: "nr-gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            field: "redditUrl",
            winners,
            rawEntry: entry,
            promptMessage,
            useEditReply,
          });
          promptMessage = res.promptMessage;
          if (res.result === "stop") {
            stopped = true;
            break;
          }
          if (res.result && res.result.action === "value") {
            await updateNrGotmGameFieldInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              field: "redditUrl",
              value: res.result.value,
            });
            NrGotm.updateRedditUrlByRound(entry.round, res.result.value, i);
          } else if (res.result && res.result.action === "no-value") {
            await updateNrGotmGameFieldInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              field: "redditUrl",
              value: AUDIT_NO_VALUE_SENTINEL,
            });
            NrGotm.updateRedditUrlByRound(entry.round, AUDIT_NO_VALUE_SENTINEL, i);
          }
        }

        if (stopped) break;

        if (
          checks.image &&
          isAuditImageMissing(game.imageBlob as any, (game as any).imageMimeType)
        ) {
          const resImg = await promptForAuditImage(interaction, {
            auditLabel: "NR-GOTM",
            tokenPrefix: "nr-gotm",
            round: entry.round,
            roundLabel,
            gameIndex: i,
            gameTitle: game.title,
            threadId: displayAuditValue(game.threadId),
            promptMessage,
            useEditReply,
          });
          promptMessage = resImg.promptMessage;
          if (resImg.result === "stop") {
            stopped = true;
            break;
          }
          if (resImg.result && resImg.result.action === "store") {
            await updateNrGotmGameImageInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              imageBlob: resImg.result.buffer,
              imageMimeType: resImg.result.mimeType,
            });
            NrGotm.updateImageByRound(entry.round, resImg.result.buffer, resImg.result.mimeType, i);
          } else if (resImg.result && resImg.result.action === "no-value") {
            await updateNrGotmGameImageInDatabase({
              rowId: (game as any).id ?? null,
              round: entry.round,
              gameIndex: i,
              imageBlob: null,
              imageMimeType: AUDIT_NO_VALUE_SENTINEL,
            });
            NrGotm.updateImageByRound(entry.round, null, AUDIT_NO_VALUE_SENTINEL, i);
          }
        }
      }

      if (stopped) break;

      if (checks.votingResults && isAuditFieldMissing(entry.votingResultsMessageId)) {
        const res = await promptForAuditValue(interaction, {
          auditLabel: "NR-GOTM",
          tokenPrefix: "nr-gotm",
          round: entry.round,
          roundLabel,
          gameIndex: null,
          gameTitle: null,
          field: "votingResults",
          winners: entry.gameOfTheMonth.map((g) => g.title),
          rawEntry: entry,
          promptMessage,
          useEditReply,
        });
        promptMessage = res.promptMessage;
        if (res.result === "stop") {
          stopped = true;
          break;
        }
        if (res.result && res.result.action === "value") {
          await updateNrGotmVotingResultsInDatabase(entry.round, res.result.value);
          NrGotm.updateVotingResultsByRound(entry.round, res.result.value);
        } else if (res.result && res.result.action === "no-value") {
          await updateNrGotmVotingResultsInDatabase(entry.round, AUDIT_NO_VALUE_SENTINEL);
          NrGotm.updateVotingResultsByRound(entry.round, AUDIT_NO_VALUE_SENTINEL);
        }
      }
    }

    if (promptMessage) {
      const finalContent = stopped ? "Audit stopped." : "Audit completed.";
      try {
        const fetchedReply = await interaction.fetchReply().catch(() => null);
        const canEdit =
          (interaction as any).editReply &&
          promptMessage &&
          promptMessage.id === fetchedReply?.id;

        if (canEdit) {
          await (interaction as any).editReply({
            content: finalContent,
            embeds: [],
            components: [],
          });
        } else {
          await promptMessage.edit({ content: finalContent, embeds: [], components: [] });
        }
      } catch (err: any) {
        if (err?.code !== 10008 && err?.code !== 50027) throw err;
        await safeReply(interaction, { content: finalContent });
      }
    } else {
      if (stopped) {
        await safeReply(interaction, { content: "Audit stopped." });
      } else {
        await safeReply(interaction, { content: "Audit completed." });
      }
    }
  }

  @Slash({
    description: "Votes are typically held the last Friday of the month",
    name: "set-nextvote",
  })
  async setNextVote(
    @SlashOption({
      description:
        "Next vote date. Votes are typically held the last Friday of the month.",
      name: "date",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    dateText: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const parsed = new Date(dateText);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
      await safeReply(interaction, {
        content:
          "Invalid date format. Please use a recognizable date such as `YYYY-MM-DD`.",
        ephemeral: true,
      });
      return;
    }

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content:
            "No voting round information is available. Create a round before setting the next vote date.",
          ephemeral: true,
        });
        return;
      }

      await BotVotingInfo.updateNextVoteAt(current.roundNumber, parsed);

      await safeReply(interaction, {
        content:
          `Next vote date updated to ${parsed.toLocaleDateString()}. `,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating next vote date: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: IGotmEntry[];
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading existing GOTM data: ${msg}`,
      });
      return;
    }

    const nextRound =
      allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

    await safeReply(interaction, {
      content: `Preparing to create GOTM round ${nextRound}.`,
    });

    const monthYearRaw = await promptUserForInput(
      interaction,
      `Enter the month/year label for round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
    );
    if (monthYearRaw === null) {
      return;
    }
    const monthYear = monthYearRaw.trim();
    if (!monthYear) {
      await safeReply(interaction, {
        content: "Month/year label cannot be empty. Creation cancelled.",
      });
      return;
    }

    const gameCountRaw = await promptUserForInput(
      interaction,
      "How many games are in this GOTM round? (1-5). Type `cancel` to abort.",
    );
    if (gameCountRaw === null) {
      return;
    }

    const gameCount = Number(gameCountRaw);
    if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
      await safeReply(interaction, {
        content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
      });
      return;
    }

    const games: IGotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const titleRaw = await promptUserForInput(
        interaction,
        `Enter the title for game #${n}.`,
      );
      if (titleRaw === null) {
        return;
      }
      const title = titleRaw.trim();
      if (!title) {
        await safeReply(interaction, {
          content: "Game title cannot be empty. Creation cancelled.",
        });
        return;
      }

      const threadRaw = await promptUserForInput(
        interaction,
        `Enter the thread ID for game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (threadRaw === null) {
        return;
      }
      const threadTrimmed = threadRaw.trim();
      const threadId =
        threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;

      const redditRaw = await promptUserForInput(
        interaction,
        `Enter the Reddit URL for game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (redditRaw === null) {
        return;
      }
      const redditTrimmed = redditRaw.trim();
      const redditUrl =
        redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;

      games.push({
        title,
        threadId,
        redditUrl,
      });
    }

    try {
      await insertGotmRoundInDatabase(nextRound, monthYear, games);
      const newEntry = Gotm.addRound(nextRound, monthYear, games);
      const embedAssets = await buildGotmEntryEmbed(
        newEntry,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `Created GOTM round ${nextRound}.`,
        embeds: [embedAssets.embed],
        files: embedAssets.files?.length ? embedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create GOTM round ${nextRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
  async addNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: INrGotmEntry[];
    try {
      allEntries = NrGotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading existing NR-GOTM data: ${msg}`,
      });
      return;
    }

    const nextRound =
      allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

    await safeReply(interaction, {
      content: `Preparing to create NR-GOTM round ${nextRound}.`,
    });

    const monthYearRaw = await promptUserForInput(
      interaction,
      `Enter the month/year label for NR-GOTM round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
    );
    if (monthYearRaw === null) {
      return;
    }
    const monthYear = monthYearRaw.trim();
    if (!monthYear) {
      await safeReply(interaction, {
        content: "Month/year label cannot be empty. Creation cancelled.",
      });
      return;
    }

    const gameCountRaw = await promptUserForInput(
      interaction,
      "How many games are in this NR-GOTM round? (1-5). Type `cancel` to abort.",
    );
    if (gameCountRaw === null) {
      return;
    }

    const gameCount = Number(gameCountRaw);
    if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
      await safeReply(interaction, {
        content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
      });
      return;
    }

    const games: INrGotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const titleRaw = await promptUserForInput(
        interaction,
        `Enter the title for NR-GOTM game #${n}.`,
      );
      if (titleRaw === null) {
        return;
      }
      const title = titleRaw.trim();
      if (!title) {
        await safeReply(interaction, {
          content: "Game title cannot be empty. Creation cancelled.",
        });
        return;
      }

      const threadRaw = await promptUserForInput(
        interaction,
        `Enter the thread ID for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (threadRaw === null) {
        return;
      }
      const threadTrimmed = threadRaw.trim();
      const threadId =
        threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;

      const redditRaw = await promptUserForInput(
        interaction,
        `Enter the Reddit URL for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (redditRaw === null) {
        return;
      }
      const redditTrimmed = redditRaw.trim();
      const redditUrl =
        redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;

      games.push({
        title,
        threadId,
        redditUrl,
      });
    }

    try {
      const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
      const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
      const newEntry = NrGotm.addRound(nextRound, monthYear, gamesWithIds);
      const embedAssets = await buildNrGotmEntryEmbed(
        newEntry,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `Created NR-GOTM round ${nextRound}.`,
        embeds: [embedAssets.embed],
        files: embedAssets.files?.length ? embedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create NR-GOTM round ${nextRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Edit GOTM data by round", name: "edit-gotm" })
  async editGotm(
    @SlashOption({
      description: "Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const roundNumber = Number(round);
    if (!Number.isFinite(roundNumber)) {
      await safeReply(interaction, {
        content: "Invalid round number.",
      });
      return;
    }

    let entries: IGotmEntry[];
    try {
      entries = Gotm.getByRound(roundNumber);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading GOTM data: ${msg}`,
      });
      return;
    }

    if (!entries.length) {
      await safeReply(interaction, {
        content: `No GOTM entry found for round ${roundNumber}.`,
      });
      return;
    }

    const entry = entries[0];

    const embedAssets = await buildGotmEntryEmbed(
      entry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Editing GOTM round ${roundNumber}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });

    const totalGames = entry.gameOfTheMonth.length;
    let gameIndex = 0;

    if (totalGames > 1) {
      const gameAnswer = await promptUserForInput(
        interaction,
        `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`,
      );
      if (gameAnswer === null) {
        return;
      }

      const idx = Number(gameAnswer);
      if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
        await safeReply(interaction, {
          content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
        });
        return;
      }
      gameIndex = idx - 1;
    }

    const fieldAnswerRaw = await promptUserForInput(
      interaction,
      "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: GotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "title") {
      field = "title";
      nullableField = false;
    } else if (fieldAnswer === "thread") {
      field = "threadId";
      nullableField = true;
    } else if (fieldAnswer === "reddit") {
      field = "redditUrl";
      nullableField = true;
    } else {
      await safeReply(interaction, {
        content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
      });
      return;
    }

    const valuePrompt = nullableField
      ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
      : `Enter the new value for ${fieldAnswer}.`;

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    }

    try {
      await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field!, newValue);

      let updatedEntry: IGotmEntry | null = null;
      if (field === "title") {
        updatedEntry = Gotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
      } else if (field === "threadId") {
        updatedEntry = Gotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
      }

      const entryToShow = updatedEntry ?? entry;
      const updatedAssets = await buildGotmEntryEmbed(
        entryToShow,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `GOTM round ${roundNumber} updated successfully.`,
        embeds: [updatedAssets.embed],
        files: updatedAssets.files?.length ? updatedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to update GOTM round ${roundNumber}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" })
  async editNrGotm(
    @SlashOption({
      description: "NR-GOTM Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const roundNumber = Number(round);
    if (!Number.isFinite(roundNumber)) {
      await safeReply(interaction, {
        content: "Invalid NR-GOTM round number.",
      });
      return;
    }

    let entries: INrGotmEntry[];
    try {
      entries = NrGotm.getByRound(roundNumber);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading NR-GOTM data: ${msg}`,
      });
      return;
    }

    if (!entries.length) {
      await safeReply(interaction, {
        content: `No NR-GOTM entry found for round ${roundNumber}.`,
      });
      return;
    }

    const entry = entries[0];

    const embedAssets = await buildNrGotmEntryEmbed(
      entry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Editing NR-GOTM round ${roundNumber}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });

    const totalGames = entry.gameOfTheMonth.length;
    let gameIndex = 0;

    if (totalGames > 1) {
      const gameAnswer = await promptUserForInput(
        interaction,
        `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`,
      );
      if (gameAnswer === null) {
        return;
      }

      const idx = Number(gameAnswer);
      if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
        await safeReply(interaction, {
          content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
        });
        return;
      }
      gameIndex = idx - 1;
    }

    const fieldAnswerRaw = await promptUserForInput(
      interaction,
      "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: NrGotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "title") {
      field = "title";
    } else if (fieldAnswer === "thread") {
      field = "threadId";
      nullableField = true;
    } else if (fieldAnswer === "reddit") {
      field = "redditUrl";
      nullableField = true;
    } else {
      await safeReply(interaction, {
        content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
      });
      return;
    }

    const valuePrompt = nullableField
      ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
      : `Enter the new value for ${fieldAnswer}.`;

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    }

    try {
      await updateNrGotmGameFieldInDatabase({
        rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
        round: roundNumber,
        gameIndex,
        field: field!,
        value: newValue,
      });

      let updatedEntry: INrGotmEntry | null = null;
      if (field === "title") {
        updatedEntry = NrGotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
      } else if (field === "threadId") {
        updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
      }

      const entryToShow = updatedEntry ?? entry;
      const updatedAssets = await buildNrGotmEntryEmbed(
        entryToShow,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `NR-GOTM round ${roundNumber} updated successfully.`,
        embeds: [updatedAssets.embed],
        files: updatedAssets.files?.length ? updatedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to update NR-GOTM round ${roundNumber}: ${msg}`,
      });
    }
  }

  @Slash({
    description: "Delete the most recent GOTM round",
    name: "delete-gotm",
  })
  async deleteGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: IGotmEntry[];
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading GOTM data: ${msg}`,
      });
      return;
    }

    if (!allEntries.length) {
      await safeReply(interaction, {
        content: "No GOTM rounds exist to delete.",
      });
      return;
    }

    const latestRound = Math.max(...allEntries.map((e) => e.round));
    const latestEntry = allEntries.find((e) => e.round === latestRound);

    if (!latestEntry) {
      await safeReply(interaction, {
        content: "Could not determine the most recent GOTM round to delete.",
      });
      return;
    }

    const summary = formatIGotmEntryForEdit(latestEntry);

    await safeReply(interaction, {
      content: [
        `You are about to delete GOTM round ${latestRound} (${latestEntry.monthYear}).`,
        "",
        "Current data:",
        "```",
        summary,
        "```",
      ].join("\n"),
    });

    const confirm = await promptUserForInput(
      interaction,
      `Type \`yes\` to confirm deletion of GOTM round ${latestRound}, or \`cancel\` to abort.`,
    );
    if (confirm === null) {
      return;
    }

    if (confirm.toLowerCase() !== "yes") {
      await safeReply(interaction, {
        content: "Delete cancelled.",
      });
      return;
    }

    try {
      const rowsDeleted = await deleteGotmRoundFromDatabase(latestRound);
      if (!rowsDeleted) {
        await safeReply(interaction, {
          content: `No database rows were deleted for GOTM round ${latestRound}. It may not exist in the database.`,
        });
        return;
      }

      Gotm.deleteRound(latestRound);

      await safeReply(interaction, {
        content: [
          `Deleted GOTM round ${latestRound} (${latestEntry.monthYear}).`,
          `Database rows deleted: ${rowsDeleted}.`,
          "",
          "Deleted data:",
          "```",
          summary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete GOTM round ${latestRound}: ${msg}`,
      });
    }
  }

  @Slash({
    description: "Delete the most recent NR-GOTM round",
    name: "delete-nr-gotm",
  })
  async deleteNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: INrGotmEntry[];
    try {
      allEntries = NrGotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading NR-GOTM data: ${msg}`,
      });
      return;
    }

    if (!allEntries.length) {
      await safeReply(interaction, {
        content: "No NR-GOTM rounds exist to delete.",
      });
      return;
    }

    const latestRound = Math.max(...allEntries.map((e) => e.round));
    const latestEntry = allEntries.find((e) => e.round === latestRound);

    if (!latestEntry) {
      await safeReply(interaction, {
        content: "Could not determine the most recent NR-GOTM round to delete.",
      });
      return;
    }

    const summary = formatIGotmEntryForEdit(latestEntry as any);

    await safeReply(interaction, {
      content: [
        `You are about to delete NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
        "",
        "Current data:",
        "```",
        summary,
        "```",
      ].join("\n"),
    });

    const confirm = await promptUserForInput(
      interaction,
      `Type \`yes\` to confirm deletion of NR-GOTM round ${latestRound}, or \`cancel\` to abort.`,
    );
    if (confirm === null) {
      return;
    }

    if (confirm.toLowerCase() !== "yes") {
      await safeReply(interaction, {
        content: "Delete cancelled.",
      });
      return;
    }

    try {
      const rowsDeleted = await deleteNrGotmRoundFromDatabase(latestRound);
      if (!rowsDeleted) {
        await safeReply(interaction, {
          content: `No database rows were deleted for NR-GOTM round ${latestRound}. It may not exist in the database.`,
        });
        return;
      }

      NrGotm.deleteRound(latestRound);

      await safeReply(interaction, {
        content: [
          `Deleted NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
          `Database rows deleted: ${rowsDeleted}.`,
          "",
          "Deleted data:",
          "```",
          summary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete NR-GOTM round ${latestRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Show help for server owner commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildSuperAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      ephemeral: true,
    });
  }

  @ButtonComponent({ id: /^superadmin-help-.+/ })
  async handleSuperAdminHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = extractSuperAdminTopicId(interaction.customId);
    const topic = topicId ? SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildSuperAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that superadmin help topic. Showing the superadmin help menu.",
      });
      return;
    }

    const helpEmbed = buildSuperAdminHelpEmbed(topic);
    const response = buildSuperAdminHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }

  @Slash({
    description: "Delete any GOTM nomination for the upcoming round",
    name: "delete-gotm-nomination",
  })
  async deleteGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: any,
    @SlashOption({
      description: "Reason for deletion (required)",
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      const targetRound = window.targetRound;
      const nomination = await getNominationForUser("gotm", targetRound, user.id);
      const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
      const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

      if (!nomination) {
        await safeReply(interaction, {
          content: `No GOTM nomination found for Round ${targetRound} by ${targetName}.`,
          ephemeral: true,
        });
        return;
      }

      await deleteNominationForUser("gotm", targetRound, user.id);
      const nominations = await listNominationsForRound("gotm", targetRound);
      const embed = buildNominationDeleteViewEmbed("GOTM", "/gotm nominate", targetRound, window, nominations);
      const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
      const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for GOTM Round ${targetRound}. Reason: ${reason}`;

      await interaction.deleteReply().catch(() => {});

      await announceNominationChange("gotm", interaction as any, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "Delete any NR-GOTM nomination for the upcoming round",
    name: "delete-nr-gotm-nomination",
  })
  async deleteNrGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: any,
    @SlashOption({
      description: "Reason for deletion (required)",
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      const targetRound = window.targetRound;
      const nomination = await getNominationForUser("nr-gotm", targetRound, user.id);
      const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
      const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

      if (!nomination) {
        await safeReply(interaction, {
          content: `No NR-GOTM nomination found for Round ${targetRound} by ${targetName}.`,
          ephemeral: true,
        });
        return;
      }

      await deleteNominationForUser("nr-gotm", targetRound, user.id);
      const nominations = await listNominationsForRound("nr-gotm", targetRound);
      const embed = buildNominationDeleteViewEmbed("NR-GOTM", "/nr-gotm nominate", targetRound, window, nominations);
      const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
      const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for NR-GOTM Round ${targetRound}. Reason: ${reason}`;

      await interaction.deleteReply().catch(() => {});

      await announceNominationChange("nr-gotm", interaction as any, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }
}

async function promptUserForInput(
  interaction: CommandInteraction,
  question: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.awaitMessages !== "function") {
    await safeReply(interaction, {
      content: "Cannot prompt for additional input; this command must be used in a text channel.",
    });
    return null;
  }

  try {
    await safeReply(interaction, {
      content: `<@${userId}> ${question}`,
    });
  } catch (err) {
    console.error("Failed to send prompt message:", err);
  }

  try {
    const collected = await channel.awaitMessages({
      filter: (m: any) => m.author?.id === userId,
      max: 1,
      time: timeoutMs,
    });

    const first = collected?.first?.();
    if (!first) {
      await safeReply(interaction, {
        content: "Timed out waiting for a response. Edit cancelled.",
      });
      return null;
    }

    const content: string = (first.content ?? "").trim();
    if (!content) {
      await safeReply(interaction, {
        content: "Empty response received. Edit cancelled.",
      });
      return null;
    }

    if (/^cancel$/i.test(content)) {
      await safeReply(interaction, {
        content: "Edit cancelled.",
      });
      return null;
    }

    return content;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    try {
      await safeReply(interaction, {
        content: `Error while waiting for a response: ${msg}`,
      });
    } catch {
      // ignore
    }
    return null;
  }
}

function formatIGotmEntryForEdit(entry: IGotmEntry): string {
  const lines: string[] = [];
  lines.push(`Round ${entry.round} - ${entry.monthYear}`);

  if (!entry.gameOfTheMonth.length) {
    lines.push("  (no games listed)");
    return lines.join("\n");
  }

  entry.gameOfTheMonth.forEach((game, index) => {
    const num = index + 1;
    const threadId = displayAuditValue(game.threadId);
    const redditUrl = displayAuditValue(game.redditUrl);
    lines.push(`${num}) Title: ${game.title}`);
    lines.push(`   Thread: ${threadId ?? "(none)"}`);
    lines.push(`   Reddit: ${redditUrl ?? "(none)"}`);
  });

  return lines.join("\n");
}

export async function isSuperAdmin(interaction: AnyRepliable): Promise<boolean> {
  const anyInteraction = interaction as any;
  const guild = interaction.guild;
  const userId = interaction.user.id;

  if (!guild) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
    });
    return false;
  }

  const ownerId = guild.ownerId;
  const isOwner = ownerId === userId;

  if (!isOwner) {
    const denial = {
      content: "Access denied. Command is restricted to the server owner.",
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (anyInteraction.replied || anyInteraction.deferred || anyInteraction.__rpgAcked) {
        await interaction.followUp(denial as any);
      } else {
        await interaction.reply(denial as any);
        anyInteraction.__rpgAcked = true;
        anyInteraction.__rpgDeferred = false;
      }
    } catch {
      // ignore
    }
  }

  return isOwner;
}
export function buildSuperAdminHelpResponse(
  activeTopicId?: SuperAdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Superadmin Commands Help")
    .setDescription("Choose a `/superadmin` subcommand button to view details (server owner only).");

  const components = buildSuperAdminHelpButtons(activeTopicId);
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return {
    embeds: [embed],
    components,
  };
}

function buildPresenceHistoryEmbed(entries: IPresenceHistoryEntry[]): EmbedBuilder {
  const descriptionLines: string[] = entries.map((entry, index) => {
    const timestamp =
      entry.setAt instanceof Date
        ? entry.setAt.toLocaleString()
        : entry.setAt
          ? String(entry.setAt)
          : "unknown date";
    const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
    return `${index + 1}. ${entry.activityName} — ${timestamp} (by ${userDisplay})`;
  });

  descriptionLines.push("");
  descriptionLines.push("Would you like to restore a previous presence?");

  return new EmbedBuilder()
    .setTitle("Presence History")
    .setDescription(descriptionLines.join("\n"));
}

function buildSuperAdminPresenceButtons(count: number): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  for (let i = 0; i < count; i++) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`superadmin-presence-restore-${i}`)
        .setLabel(String(i + 1))
        .setStyle(ButtonStyle.Success),
    );
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("superadmin-presence-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}
