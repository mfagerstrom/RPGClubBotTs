import { dirname, importx } from "@discordx/importer";
import type {  Interaction, Message } from "discord.js";
import { ActivityType, IntentsBitField } from "discord.js";
import { Client } from "discordx";

import { setPresence } from "./functions/SetPresence.js";
import presenceJSON from "./data/presence.json" assert { type: "json" };
// import * as mongoDB from './config/database.js'

import { scanGuild } from "./utilities/guildUtils.js";

import dotenv from 'dotenv';
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

  // Set stored presence state
  bot.user!.setPresence({ 
    activities: [{ 
      name: presenceJSON, 
      type: ActivityType.Playing,
    }],
    status: 'online',
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
});

bot.on("interactionCreate", (interaction: Interaction) => {
  bot.executeInteraction(interaction);
});

bot.on("messageCreate", (message: Message) => {
  void bot.executeCommand(message);
});



async function run() {
  // The following syntax should be used in the ECMAScript environment
  await importx(`${dirname(import.meta.url)}/{events,commands}/**/*.command.{ts,js}`);

  // Let's start the bot
  if (!process.env.BOT_TOKEN) {
    throw Error("Could not find BOT_TOKEN in your environment");
  }

  // Log in with your bot token
  await bot.login(process.env.BOT_TOKEN);
}

void run();
// console.log(process.env.MONGO_USERNAME);
// console.log(process.env.MONGO_PASSWORD);
// await mongoDB.run();
