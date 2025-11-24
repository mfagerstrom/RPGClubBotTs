import { dirname, importx } from "@discordx/importer";
import type { Channel, Interaction, Message, TextBasedChannel } from "discord.js";
import { IntentsBitField } from "discord.js";
import { Client } from "discordx";

import dotenv from "dotenv";
import { restorePresenceIfMissing, updateBotPresence } from "./functions/SetPresence.js";

import { initOraclePool } from "./db/oracleClient.js";
import { loadGotmFromDb } from "./classes/Gotm.js";
import { loadNrGotmFromDb } from "./classes/NrGotm.js";
import {
  installConsoleLogging,
  setConsoleLoggingClient,
} from "./utilities/DiscordConsoleLogger.js";
import { startNominationReminderService } from "./services/NominationReminderService.js";
import { startReminderService } from "./services/ReminderService.js";

dotenv.config();
installConsoleLogging();

const PRESENCE_CHECK_INTERVAL_MS: number = 30 * 60 * 1000;

export const bot: Client = new Client({
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

type ChannelWithName = { id?: string; name?: string };

function getChannelName(channel: Channel | TextBasedChannel | null): string {
  if (!channel) {
    return "unknown";
  }

  const candidate: ChannelWithName = channel as ChannelWithName;
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
  console.log("Startup sequence completed.");
});

bot.on("interactionCreate", async (interaction: Interaction) => {
  if ("isChatInputCommand" in interaction && interaction.isChatInputCommand()) {
    const userTag: string = interaction.user?.tag ?? interaction.user?.id ?? "unknown";
    const channel: Channel | null = interaction.channel;
    const channelName: string = getChannelName(channel);
    console.log(`[SlashCommand] /${interaction.commandName} by ${userTag} in ${channelName}`);
  }

  await bot.executeInteraction(interaction);
});

bot.on("messageCreate", async (message: Message) => {
  const content: string = message.content ?? "";
  const prefix: string = "!";

  if (content.startsWith(prefix)) {
    const withoutPrefix: string = content.slice(prefix.length).trim();
    const [commandName, ...args]: string[] = withoutPrefix.split(/\s+/);
    const userTag: string = message.author?.tag ?? message.author?.id ?? "unknown";
    const channel: TextBasedChannel = message.channel;
    const channelName: string = getChannelName(channel);
    console.log(
      `[MessageCommand] ${prefix}${commandName} by ${userTag} in ${channelName} args=${args.join(
        " ",
      )}`,
    );
  }

  await bot.executeCommand(message);
});

type DiscordClientError = { code?: number | string; rawError?: { code?: number | string } };

bot.on("error", (err: unknown) => {
  const normalizedErr: DiscordClientError | undefined =
    typeof err === "object" && err !== null ? (err as DiscordClientError) : undefined;
  const code: number | string | undefined = normalizedErr?.code ?? normalizedErr?.rawError?.code;
  if (code === 40060 || code === 10062) {
    // Ignore ack/unknown-interaction noise
    return;
  }
  console.error("Discord client error:", err);
});

async function run(): Promise<void> {
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
