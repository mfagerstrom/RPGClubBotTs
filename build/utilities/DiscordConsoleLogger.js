const LOG_CHANNEL_ID = "1439333324547035428";
const originalConsole = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
};
let discordClient = null;
let logChannel = null;
let resolvingChannel = false;
function formatArgs(args) {
    return args
        .map((a) => {
        if (typeof a === "string")
            return a;
        if (a instanceof Error)
            return a.stack ?? a.message;
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    })
        .join(" ");
}
async function ensureChannel() {
    if (!discordClient)
        return null;
    if (logChannel)
        return logChannel;
    if (resolvingChannel)
        return logChannel;
    resolvingChannel = true;
    try {
        const channel = await discordClient.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (channel && typeof channel.send === "function") {
            logChannel = channel;
        }
    }
    finally {
        resolvingChannel = false;
    }
    return logChannel;
}
async function sendToDiscord(level, message) {
    try {
        const channel = await ensureChannel();
        if (!channel)
            return;
        const prefix = `[${level.toUpperCase()}] `;
        const text = prefix + message;
        const maxLen = 1900;
        const trimmed = text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
        await channel.send(trimmed);
    }
    catch {
        // Swallow to avoid recursive console logging on failures
    }
}
export function installConsoleLogging() {
    const levels = ["log", "error", "warn", "info", "debug"];
    for (const level of levels) {
        console[level] = (...args) => {
            const msg = formatArgs(args);
            originalConsole[level](...args);
            void sendToDiscord(level, msg);
        };
    }
}
export function setConsoleLoggingClient(client) {
    discordClient = client;
}
