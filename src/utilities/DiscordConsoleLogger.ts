import { AttachmentBuilder, EmbedBuilder, type MessageCreateOptions, type TextBasedChannel } from "discord.js";
import type { Client } from "discordx";

import { DISCORD_CONSOLE_LOG_CHANNEL_ID } from "../config/channels.js";
import { resolveAssetPath } from "../functions/AssetPath.js";
const MAX_DESCRIPTION_LENGTH = 3900;
const LEVEL_COLORS: Record<string, number> = {
  log: 0x95a5a6,
  info: 0x3498db,
  warn: 0xf39c12,
  error: 0xe74c3c,
  debug: 0x9b59b6,
};
const LOG_BATCH_INTERVAL_MS = 15 * 1000;
const FORCE_WIDTH_IMAGE_NAME = "force-message-width.png";
const FORCE_WIDTH_IMAGE_PATH = resolveAssetPath("images", FORCE_WIDTH_IMAGE_NAME);
const STARTUP_COMPLETE_LOG = "Startup sequence completed.";
const STARTUP_ALLOWED_LOG_PATTERNS: RegExp[] = [
  /^bot >> connecting discord\.\.\.$/i,
  /^RPGClub GameDB >> commands >> global$/,
  /^>> adding\s+\d+\s+\[.*\]$/,
  /^>> deleting\s+\d+\s+\[.*\]$/,
  /^>> skipping\s+\d+\s+\[.*\]$/,
  /^>> updating\s+\d+\s+\[.*\]$/,
  /^\[ThreadSync\] Service started$/,
  /^\[ThreadLinkPrompt\] Service started$/,
  /^Startup sequence completed\.$/,
];

type ConsoleLevel = "log" | "error" | "warn" | "info" | "debug";

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

type ILoggerChannel = TextBasedChannel & { send: (options: MessageCreateOptions) => Promise<unknown> };

let discordClient: Client | null = null;
let logChannel: ILoggerChannel | null = null;
let resolvingChannel = false;
let logBuffer: { time: number; message: string }[] = [];
let logBufferTimer: NodeJS.Timeout | null = null;
let startupLogFilterEnabled = true;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function isAllowedStartupLog(message: string): boolean {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) return false;
  return lines.every((line) =>
    STARTUP_ALLOWED_LOG_PATTERNS.some((pattern) => pattern.test(line))
  );
}

function shouldSendToDiscord(level: ConsoleLevel, message: string): boolean {
  if (!startupLogFilterEnabled) return true;
  if (level === "log" && isAllowedStartupLog(message)) {
    if (message.includes(STARTUP_COMPLETE_LOG)) {
      startupLogFilterEnabled = false;
    }
    return true;
  }
  return false;
}

async function ensureChannel(): Promise<ILoggerChannel | null> {
  if (!discordClient) return null;
  if (logChannel) return logChannel;
  if (resolvingChannel) return logChannel;

  resolvingChannel = true;
  try {
    const channel = await discordClient.channels.fetch(DISCORD_CONSOLE_LOG_CHANNEL_ID).catch(() => null);
    const sendable = channel as { send?: unknown } | null;
    if (channel && channel.isTextBased() && typeof sendable?.send === "function") {
      logChannel = channel as ILoggerChannel;
    }
  } finally {
    resolvingChannel = false;
  }

  return logChannel;
}

function buildConsoleMessageOptions(embed: EmbedBuilder): MessageCreateOptions {
  embed.setImage(`attachment://${FORCE_WIDTH_IMAGE_NAME}`);
  return {
    embeds: [embed],
    files: [new AttachmentBuilder(FORCE_WIDTH_IMAGE_PATH, { name: FORCE_WIDTH_IMAGE_NAME })],
  };
}

async function sendEmbedToChannel(channel: ILoggerChannel, embed: EmbedBuilder): Promise<void> {
  const options = buildConsoleMessageOptions(embed);
  try {
    await channel.send(options);
  } catch {
    // If image attachment fails, still send the log message.
    await channel.send({ embeds: [embed] });
  }
}

async function flushLogBuffer(): Promise<void> {
  if (logBuffer.length === 0) return;

  const logsToSend = [...logBuffer].sort((a, b) => a.time - b.time);
  logBuffer = [];

  const channel = await ensureChannel();
  if (!channel) {
    return;
  }

  try {
    let currentDescription = "";
    const embeds: EmbedBuilder[] = [];

    for (const item of logsToSend) {
      const line = item.message;
      const nextLine = `${line}\n`;
      if (currentDescription.length + nextLine.length > MAX_DESCRIPTION_LENGTH - 8) {
        embeds.push(
          new EmbedBuilder()
            .setDescription(`\`\`\`\n${currentDescription}\`\`\``)
            .setColor(LEVEL_COLORS.log)
            .setTimestamp(new Date()),
        );
        currentDescription = "";
      }

      currentDescription += nextLine;
    }

    if (currentDescription.length > 0) {
      embeds.push(
        new EmbedBuilder()
          .setDescription(`\`\`\`\n${currentDescription}\`\`\``)
          .setColor(LEVEL_COLORS.log)
          .setTimestamp(new Date()),
      );
    }

    for (const embed of embeds) {
      await sendEmbedToChannel(channel, embed);
    }
  } catch {
    // Swallow to avoid recursive console logging on failures
  }
}

async function sendToDiscord(level: ConsoleLevel, message: string): Promise<void> {
  try {
    if (!shouldSendToDiscord(level, message)) {
      return;
    }

    if (level === "log") {
      logBuffer.push({ message, time: Date.now() });
      if (!logBufferTimer) {
        logBufferTimer = setInterval(() => void flushLogBuffer(), LOG_BATCH_INTERVAL_MS);
      }
      return;
    }

    // Filter out noisy Discord client acknowledgement errors
    if (
      level === "error" &&
      message.includes("Discord client error:") &&
      (message.includes("DiscordAPIError[40060]") || message.includes("DiscordAPIError[10062]"))
    ) {
      return;
    }

    const channel = await ensureChannel();
    if (!channel) return;

    const prefix = `[${level.toUpperCase()}] `;
    const text = prefix + message;
    const shouldWrapInCodeBlock = level === "error" || level === "warn";
    const maxTextLength = shouldWrapInCodeBlock ? MAX_DESCRIPTION_LENGTH - 8 : MAX_DESCRIPTION_LENGTH;
    const trimmed = text.length > maxTextLength ? text.slice(0, maxTextLength - 3) + "..." : text;
    const description = shouldWrapInCodeBlock ? `\`\`\`\n${trimmed}\n\`\`\`` : trimmed;
    const embed = new EmbedBuilder()
      .setDescription(description)
      .setColor(LEVEL_COLORS[level] ?? LEVEL_COLORS.log)
      .setTimestamp(new Date());

    await sendEmbedToChannel(channel, embed);
  } catch {
    // Swallow to avoid recursive console logging on failures
  }
}

export function installConsoleLogging(): void {
  const levels: ConsoleLevel[] = ["log", "error", "warn", "info", "debug"];

  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      const msg = formatArgs(args);
      originalConsole[level](...args);
      void sendToDiscord(level, msg);
    };
  }
}

export function setConsoleLoggingClient(client: Client): void {
  discordClient = client;
}

export async function logToDiscord(message: string, level: ConsoleLevel = "log"): Promise<void> {
  const msg = formatArgs([message]);
  await sendToDiscord(level, msg);
}
