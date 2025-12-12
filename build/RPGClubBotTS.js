import "dotenv/config";
import { dirname, importx } from "@discordx/importer";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";
import { restorePresenceIfMissing, updateBotPresence } from "./functions/SetPresence.js";
import { initOraclePool } from "./db/oracleClient.js";
import { loadGotmFromDb } from "./classes/Gotm.js";
import { loadNrGotmFromDb } from "./classes/NrGotm.js";
import { installConsoleLogging, setConsoleLoggingClient, } from "./utilities/DiscordConsoleLogger.js";
import { startNominationReminderService } from "./services/NominationReminderService.js";
import { startReminderService } from "./services/ReminderService.js";
import Member from "./classes/Member.js";
import { joinAllTargetForumThreads } from "./services/ForumThreadJoinService.js";
import { startRssFeedService } from "./services/RssFeedService.js";
import { startPublicReminderService } from "./services/PublicReminderService.js";
import { startThreadSyncService } from "./services/ThreadSyncService.js";
import { startThreadLinkPromptService } from "./services/ThreadLinkPromptService.js";
installConsoleLogging();
const PRESENCE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const bot = new Client({
    // To use only guild command
    // botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],
    // Discord intents
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.MessageContent,
    ],
    // Debug logs are disabled in silent mode
    silent: false,
    // Configuration for @SimpleCommand
    simpleCommand: {
        prefix: "!",
    },
});
function getChannelName(channel) {
    if (!channel) {
        return "unknown";
    }
    const candidate = channel;
    if (typeof candidate.name === "string" && candidate.name.length > 0) {
        return `#${candidate.name}`;
    }
    if (typeof candidate.id === "string" && candidate.id.length > 0) {
        return candidate.id;
    }
    return "unknown";
}
bot.once("clientReady", async () => {
    // Make sure all guilds are cached
    await bot.guilds.fetch();
    setConsoleLoggingClient(bot);
    // Set presence state from stored value
    await updateBotPresence(bot);
    // Periodically refresh presence from the database to stay in sync
    setInterval(() => {
        void updateBotPresence(bot);
    }, PRESENCE_CHECK_INTERVAL_MS);
    // Periodically ensure presence is restored if Discord drops it
    setInterval(() => {
        void restorePresenceIfMissing(bot);
    }, PRESENCE_CHECK_INTERVAL_MS);
    // Synchronize applications commands with Discord
    await bot.initApplicationCommands();
    // To clear all guild commands, uncomment this line,
    // This is useful when moving from guild commands to global commands
    // It must only be executed once
    //
    //  await bot.clearApplicationCommands(
    //    ...bot.guilds.cache.map((g) => g.id)
    //  );
    startNominationReminderService(bot);
    startReminderService(bot);
    startPublicReminderService(bot);
    startThreadSyncService(bot);
    startThreadLinkPromptService(bot);
    await joinAllTargetForumThreads(bot);
    startRssFeedService(bot);
    console.log("Startup sequence completed.");
});
bot.on("interactionCreate", async (interaction) => {
    if ("isChatInputCommand" in interaction && interaction.isChatInputCommand()) {
        const userTag = interaction.user?.tag ?? interaction.user?.id ?? "unknown";
        const channel = interaction.channel;
        const channelName = getChannelName(channel);
        console.log(`[SlashCommand] /${interaction.commandName} by ${userTag} in ${channelName}`);
        if (interaction.user?.id) {
            void Member.touchLastSeen(interaction.user.id);
        }
    }
    await bot.executeInteraction(interaction);
});
bot.on("messageCreate", async (message) => {
    const content = message.content ?? "";
    const prefix = "!";
    if (content.startsWith(prefix)) {
        const withoutPrefix = content.slice(prefix.length).trim();
        const [commandName, ...args] = withoutPrefix.split(/\s+/);
        const userTag = message.author?.tag ?? message.author?.id ?? "unknown";
        const channel = message.channel;
        const channelName = getChannelName(channel);
        console.log(`[MessageCommand] ${prefix}${commandName} by ${userTag} in ${channelName} args=${args.join(" ")}`);
    }
    if (message.author?.id && !message.author.bot) {
        void Member.recordMessageActivity(message.author.id);
    }
    await bot.executeCommand(message);
});
bot.on("error", (err) => {
    const normalizedErr = typeof err === "object" && err !== null ? err : undefined;
    const code = normalizedErr?.code ?? normalizedErr?.rawError?.code;
    if (code === 40060 || code === 10062) {
        // Ignore ack/unknown-interaction noise
        return;
    }
    console.error("Discord client error:", err);
});
async function run() {
    if (!process.env.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in your environment");
    }
    await initOraclePool();
    await loadGotmFromDb();
    await loadNrGotmFromDb();
    await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.{command,handler}.{ts,js}`);
    await bot.login(process.env.BOT_TOKEN);
}
void run();
