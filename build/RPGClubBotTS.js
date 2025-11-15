import { dirname, importx } from "@discordx/importer";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";
import dotenv from "dotenv";
import { updateBotPresence } from "./functions/SetPresence.js";
import { initOraclePool } from "./db/oracleClient.js";
import { loadGotmFromDb } from "./classes/Gotm.js";
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
bot.on("interactionCreate", (interaction) => {
    bot.executeInteraction(interaction);
});
bot.on("messageCreate", (message) => {
    void bot.executeCommand(message);
});
async function run() {
    if (!process.env.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in your environment");
    }
    await initOraclePool();
    await loadGotmFromDb();
    await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.command.{ts,js}`);
    await bot.login(process.env.BOT_TOKEN);
}
void run();
