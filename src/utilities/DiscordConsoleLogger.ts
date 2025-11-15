const LOG_CHANNEL_ID = "1439333324547035428";

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
    const channel = await ensureChannel();
    if (!channel) return;

    const prefix = `[${level.toUpperCase()}] `;
    const text = prefix + message;
    const maxLen = 1900;
    const trimmed = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;

    await (channel as any).send(trimmed);
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

