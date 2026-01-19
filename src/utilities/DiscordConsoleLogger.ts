import { EmbedBuilder } from "discord.js";

const LOG_CHANNEL_ID = "1439333324547035428";
const MAX_DESCRIPTION_LENGTH = 3900;
const LEVEL_COLORS: Record<ConsoleLevel, number> = {
  log: 0x95a5a6,
  info: 0x3498db,
  warn: 0xf39c12,
  error: 0xe74c3c,
  debug: 0x9b59b6,
};

type ConsoleLevel = "log" | "error" | "warn" | "info" | "debug";

const originalConsole = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: console.info.bind(console),
  debug: (console as any).debug ? (console as any).debug.bind(console) : console.log.bind(console),
};

let discordClient: any | null = null;
let logChannel: any | null = null;
let resolvingChannel = false;

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

async function ensureChannel(): Promise<any | null> {
  if (!discordClient) return null;
  if (logChannel) return logChannel;
  if (resolvingChannel) return logChannel;

  resolvingChannel = true;
  try {
    const channel = await discordClient.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (channel && typeof (channel as any).send === "function") {
      logChannel = channel;
    }
  } finally {
    resolvingChannel = false;
  }

  return logChannel;
}

async function sendToDiscord(level: ConsoleLevel, message: string): Promise<void> {
  try {
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
    const trimmed =
      text.length > MAX_DESCRIPTION_LENGTH ? text.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "..." : text;
    const embed = new EmbedBuilder()
      .setDescription(trimmed)
      .setColor(LEVEL_COLORS[level] ?? LEVEL_COLORS.log)
      .setTimestamp(new Date());

    await (channel as any).send({ embeds: [embed] });
  } catch {
    // Swallow to avoid recursive console logging on failures
  }
}

export function installConsoleLogging(): void {
  const levels: ConsoleLevel[] = ["log", "error", "warn", "info", "debug"];

  for (const level of levels) {
    (console as any)[level] = (...args: unknown[]) => {
      const msg = formatArgs(args);
      (originalConsole as any)[level](...args);
      void sendToDiscord(level, msg);
    };
  }
}

export function setConsoleLoggingClient(client: any): void {
  discordClient = client;
}

export async function logToDiscord(message: string, level: ConsoleLevel = "log"): Promise<void> {
  const msg = formatArgs([message]);
  await sendToDiscord(level, msg);
}
