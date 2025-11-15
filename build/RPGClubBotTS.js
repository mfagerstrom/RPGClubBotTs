import { dirname, importx } from "@discordx/importer";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";
import dotenv from "dotenv";
import { updateBotPresence } from "./functions/SetPresence.js";
import { initOraclePool } from "./db/oracleClient.js";
import { loadGotmFromDb } from "./classes/Gotm.js";
import { loadNrGotmFromDb } from "./classes/NrGotm.js";
import { installConsoleLogging, setConsoleLoggingClient } from "./utilities/DiscordConsoleLogger.js";
dotenv.config();
installConsoleLogging();
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
bot.once("clientReady", async () => {
    // Make sure all guilds are cached
    await bot.guilds.fetch();
    setConsoleLoggingClient(bot);
    // Set presence state from stored value
    await updateBotPresence(bot);
    // Synchronize applications commands with Discord
    void bot.initApplicationCommands();
    // To clear all guild commands, uncomment this line,
    // This is useful when moving from guild commands to global commands
    // It must only be executed once
    //
    //  await bot.clearApplicationCommands(
    //    ...bot.guilds.cache.map((g) => g.id)
    //  );
    console.log("Bot started");
});
bot.on("interactionCreate", async (interaction) => {
    if ("isChatInputCommand" in interaction && interaction.isChatInputCommand()) {
        const userTag = interaction.user?.tag ?? interaction.user?.id ?? "unknown";
        const channel = interaction.channel;
        const channelName = channel?.name ? `#${channel.name}` : channel?.id ?? "unknown";
        console.log(`[SlashCommand] /${interaction.commandName} by ${userTag} in ${channelName}`);
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
        const channelName = channel?.name ? `#${channel.name}` : channel?.id ?? "unknown";
        console.log(`[MessageCommand] ${prefix}${commandName} by ${userTag} in ${channelName} args=${args.join(" ")}`);
    }
    await bot.executeCommand(message);
});
bot.on("error", (err) => {
    console.error("Discord client error:", err);
});
async function run() {
    if (!process.env.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in your environment");
    }
    await initOraclePool();
    await loadGotmFromDb();
    await loadNrGotmFromDb();
    await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.command.{ts,js}`);
    await bot.login(process.env.BOT_TOKEN);
}
void run();
