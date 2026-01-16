import { MessageFlags } from "discord.js";
import type {
  CommandInteraction,
  InteractionDeferReplyOptions,
  RepliableInteraction,
} from "discord.js";

export type AnyRepliable = RepliableInteraction | CommandInteraction;

type SanitizeOptions = {
  maxLength?: number;
  preserveNewlines?: boolean;
  allowPattern?: RegExp;
  blockSql?: boolean;
  blockSqlKeywords?: boolean;
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000D\\u000E-\\u001F\\u007F-\\u009F]", "g");

export function sanitizeUserInput(value: string, options?: SanitizeOptions): string {
  const opts = {
    maxLength: options?.maxLength,
    preserveNewlines: options?.preserveNewlines ?? true,
    allowPattern: options?.allowPattern,
    blockSql: options?.blockSql ?? true,
    blockSqlKeywords: options?.blockSqlKeywords ?? false,
  };

  let sanitized = value ?? "";
  try {
    sanitized = sanitized.normalize("NFKC");
  } catch {
    // ignore normalization errors
  }

  sanitized = sanitized.replace(/\r\n/g, "\n");
  sanitized = sanitized.replace(CONTROL_CHAR_REGEX, "");
  sanitized = sanitized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
  sanitized = sanitized.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  sanitized = sanitized.replace(/<[^>]+>/g, "");
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "");
  sanitized = sanitized.replace(/`[^`]*`/g, "");
  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s{0,3}#+\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*>\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*[-*+]\s+/g, "$1");
  sanitized = sanitized.replace(/[*_~]/g, "");
  sanitized = sanitized.replace(/<@!?(\d+)>/g, "");
  sanitized = sanitized.replace(/<@&(\d+)>/g, "");
  sanitized = sanitized.replace(/<#(\d+)>/g, "");
  sanitized = sanitized.replace(/@(everyone|here)/gi, "");

  if (opts.blockSql) {
    sanitized = sanitized.replace(/--/g, "");
    sanitized = sanitized.replace(/\/\*/g, "");
    sanitized = sanitized.replace(/\*\//g, "");
    sanitized = sanitized.replace(/;/g, "");
  }
  if (opts.blockSqlKeywords) {
    sanitized = sanitized.replace(
      /\b(select|insert|update|delete|drop|alter|create|truncate|exec|union|merge)\b/gi,
      "",
    );
  }

  if (opts.allowPattern) {
    const pattern = new RegExp(opts.allowPattern.source, opts.allowPattern.flags.replace("g", ""));
    sanitized = sanitized.split("").filter((ch) => pattern.test(ch)).join("");
  }

  if (opts.preserveNewlines) {
    sanitized = sanitized
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .join("\n");
    sanitized = sanitized.replace(/\n{3,}/g, "\n\n");
  } else {
    sanitized = sanitized.replace(/\s+/g, " ");
  }

  sanitized = sanitized.trim();
  if (opts.maxLength && sanitized.length > opts.maxLength) {
    sanitized = sanitized.slice(0, opts.maxLength);
  }

  return sanitized.trim();
}

export function sanitizeOptionalInput(
  value: string | null | undefined,
  options?: SanitizeOptions,
): string | undefined {
  if (value == null) return undefined;
  const sanitized = sanitizeUserInput(value, options);
  return sanitized.length ? sanitized : undefined;
}

export function stripModalInput(value: string): string {
  return sanitizeUserInput(value);
}

function normalizeOptions(options: any): any {
  if (typeof options === "string" || options === null || options === undefined) {
    return options;
  }

  const {
    __forceFollowUp: _forceFollowUp,
    ...restOptions
  } = options as any;
  void _forceFollowUp;

  if ("ephemeral" in options) {
    const { ephemeral, flags, ...rest } = restOptions as any;
    const newFlags = ephemeral ? ((flags ?? 0) | MessageFlags.Ephemeral) : flags;
    return { ...rest, flags: newFlags };
  }

  return restOptions;
}

// Safely defer a reply, ignoring errors and avoiding double-deferral
export async function safeDeferReply(
  interaction: AnyRepliable,
  options?: InteractionDeferReplyOptions,
): Promise<void> {
  const anyInteraction = interaction as any;

  let deferOptions: InteractionDeferReplyOptions | undefined = options;
  try {
    if (
      !deferOptions &&
      typeof (interaction as any).isChatInputCommand === "function" &&
      (interaction as any).isChatInputCommand() &&
      ["admin", "mod", "superadmin"].includes((interaction as any).commandName)
    ) {
      deferOptions = { flags: MessageFlags.Ephemeral };
    }
  } catch {
    // ignore detection issues
  }

  // Custom flag so our helpers can reliably detect an acknowledgement
  if (anyInteraction.__rpgAcked || anyInteraction.deferred || anyInteraction.replied) {
    return;
  }

  try {
    if (typeof anyInteraction.deferReply === "function") {
      const normalized = deferOptions ? normalizeOptions(deferOptions) : deferOptions;
      await anyInteraction.deferReply(normalized as any);
      anyInteraction.__rpgAcked = true;
      anyInteraction.__rpgDeferred = true;
    }
  } catch {
    // ignore errors from deferReply (e.g., already acknowledged)
  }
}

// Ensure we do not hit "Interaction already acknowledged" when replying
const isAckError = (err: any): boolean => {
  const code = err?.code ?? err?.rawError?.code;
  return code === 40060 || code === 10062;
};

export async function safeReply(interaction: AnyRepliable, options: any): Promise<any> {
  const anyInteraction = interaction as any;
  const forceFollowUp = Boolean(options?.__forceFollowUp);
  const normalizedOptions = normalizeOptions(options);

  const deferred: boolean = Boolean(
    anyInteraction.__rpgDeferred !== undefined
      ? anyInteraction.__rpgDeferred
      : anyInteraction.deferred,
  );
  const replied: boolean = Boolean(anyInteraction.replied);
  const acked: boolean = Boolean(anyInteraction.__rpgAcked ?? deferred ?? replied);

  if (forceFollowUp) {
    try {
      if (typeof options === "string") {
        return await interaction.followUp({ content: options });
      } else {
        return await interaction.followUp(normalizedOptions as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // If we've deferred but not yet replied, edit the original reply
  if (deferred && !replied) {
    try {
      if (typeof options === "string") {
        return await interaction.editReply({ content: options });
      } else {
        return await interaction.editReply(normalizedOptions as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // If we've already replied, or we know the interaction was acknowledged,
  // send a follow-up message instead of trying to reply again.
  if (replied || acked || forceFollowUp) {
    try {
      if (typeof options === "string") {
        return await interaction.followUp({ content: options });
      } else {
        return await interaction.followUp(normalizedOptions as any);
      }
    } catch (err: any) {
      if (!isAckError(err)) throw err;
    }
    return;
  }

  // First-time acknowledgement: normal reply
  try {
    const replyOptions = typeof options === "string"
      ? { content: options }
      : { ...normalizedOptions };

    const result = await interaction.reply(replyOptions as any);
    anyInteraction.__rpgAcked = true;
    return result;
  } catch (err: any) {
    if (!isAckError(err)) throw err;
  }
}

// Try to update an existing interaction message; fall back to a normal reply if needed.
export async function safeUpdate(interaction: AnyRepliable, options: any): Promise<void> {
  const anyInteraction = interaction as any;
  const normalizedOptions = normalizeOptions(options);

  if (typeof anyInteraction.update === "function") {
    try {
      await anyInteraction.update(normalizedOptions);
      anyInteraction.__rpgAcked = true;
      anyInteraction.__rpgDeferred = false;
      return;
    } catch (err: any) {
      if (!isAckError(err)) {
        // Fall back to follow-up path below
      } else {
        return;
      }
    }
  }

  await safeReply(interaction, { ...normalizedOptions, flags: MessageFlags.Ephemeral });
}
