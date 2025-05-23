import { dirname, importx } from "@discordx/importer";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";
import { scanGuild } from "./utilities/ScanGuild.js";
import dotenv from 'dotenv';
//import { updateBotPresence } from "./functions/SetPresence.js";
dotenv.config();
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
bot.once("ready", async () => {
    // Make sure all guilds are cached
    await bot.guilds.fetch();
    // Set presence state, hardcoded for now to the NR GOTM since Bamiji's bot features the GOTM
    bot.user.setPresence({
    // activities: [{ 
    //   name: 'Sakuna: Of Rice and Ruin [NR GOTM Round 123]', 
    //   type: ActivityType.Playing,
    // }],
    // status: 'online',
    });
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
    // scan guild members
    scanGuild(bot);
    // Set stored presence state
    // await updateBotPresence(bot);
});
bot.on("interactionCreate", (interaction) => {
    bot.executeInteraction(interaction);
});
bot.on("messageCreate", (message) => {
    void bot.executeCommand(message);
});
async function run() {
    await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.command.{ts,js}`);
    if (!process.env.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in your environment");
    }
    // Log in with your bot token
    await bot.login(process.env.BOT_TOKEN);
}
void run();
