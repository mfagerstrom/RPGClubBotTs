import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { setThreadGameLink, setThreadSkipLinking } from "../classes/Thread.js";
import Game from "../classes/Game.js";
import { igdbService, type IGDBGameDetails } from "../services/IgdbService.js";

const NOW_PLAYING_FORUM_ID = "1059875931356938240";
const PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
const promptCache = new Map<string, number>();

function shouldPrompt(threadId: string): boolean {
  const last = promptCache.get(threadId) ?? 0;
  return Date.now() - last > PROMPT_COOLDOWN_MS;
}

function markPrompted(threadId: string): void {
  promptCache.set(threadId, Date.now());
}

function buildPromptEmbed(thread: ThreadChannel): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("Link this thread to a game?")
    .setDescription(
      "This Now Playing thread doesn't have a linked GameDB entry yet. " +
        "Linking helps show the right cover art, metadata, and GOTM/NR-GOTM info.\n\n" +
        "Choose an option below.",
    )
    .setColor(0x2d7ff9)
    .setFooter({ text: thread.name ?? thread.id });
}

function buildButtons(threadId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`thread-link:${threadId}`)
      .setLabel("Link a game")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`thread-skip:${threadId}`)
      .setLabel("Skip Linking Game")
      .setStyle(ButtonStyle.Secondary),
  );
}

async function promptThread(thread: ThreadChannel): Promise<void> {
  if (!shouldPrompt(thread.id)) return;
  markPrompted(thread.id);

  try {
    await thread.send({ embeds: [buildPromptEmbed(thread)], components: [buildButtons(thread.id)] });
  } catch (err) {
    console.error("[ThreadLinkPrompt] Failed to post prompt:", err);
  }
}

async function handleLinkButton(interaction: ButtonInteraction, threadId: string): Promise<void> {
  if (!interaction.guild || !interaction.channel) return;

  // Ask for game title
  await interaction.deferReply({ ephemeral: true });
  await interaction.followUp({
    content: "Please enter the game title to search (reply in this channel). Waiting 60s...",
    ephemeral: true,
  });

  const channel = interaction.channel as TextChannel;
  let title: string | null = null;
  try {
    const collected = await channel.awaitMessages({
      filter: (m: Message) => m.author?.id === interaction.user.id,
      max: 1,
      time: 60_000,
    });
    title = collected.first()?.content?.trim() ?? null;
  } catch {
    // ignore
  }

  if (!title) {
    await interaction.followUp({ content: "No title received. Cancelled.", ephemeral: true });
    return;
  }

  // Use existing IGDB search
  try {
    const searchRes = await igdbService.searchGames(title, 5, false);
    const results = searchRes.results;
    if (!results.length) {
      await interaction.followUp({ content: "No results found.", ephemeral: true });
      return;
    }

    // If one result, auto-link; otherwise pick first for now (keep simple)
    const chosen = results[0];
    // Ensure game exists in GameDB or import
    let gameId: number | null = null;
    const existing = await Game.getGameByIgdbId(chosen.id);
    if (existing) {
      gameId = existing.id;
    } else {
      const details: IGDBGameDetails | null = await igdbService.getGameDetails(chosen.id);
      if (!details) {
        await interaction.followUp({ content: "Failed to load game details from IGDB.", ephemeral: true });
        return;
      }
      const newGame = await Game.createGame(
        details.name,
        details.summary ?? "",
        null,
        details.id,
        details.slug ?? null,
        details.total_rating ?? null,
        details.url ?? null,
      );
      gameId = newGame.id;
      await Game.saveFullGameMetadata(gameId, details);
    }

    await setThreadGameLink(threadId, gameId!);
    await interaction.followUp({
      content:
        `Linked this thread to GameDB #${gameId} (${chosen.name}).\n` +
        "Thank you! If the wrong game was linked by mistake, please contact @merph.",
      ephemeral: true,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await interaction.followUp({ content: `Failed to link game: ${msg}`, ephemeral: true });
  }
}

async function handleSkipButton(interaction: ButtonInteraction, threadId: string): Promise<void> {
  try {
    await setThreadSkipLinking(threadId, true);
    await interaction.reply({
      content: "Okay, I'll skip linking a game for this thread going forward.",
      ephemeral: true,
    });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await interaction.reply({ content: `Failed to update skip flag: ${msg}`, ephemeral: true });
  }
}

export function startThreadLinkPromptService(client: Client): void {
  client.on("threadCreate", async (thread) => {
    if (thread.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(thread);
  });

  client.on("messageCreate", async (message) => {
    const channel = message.channel;
    if (!("isThread" in channel) || !channel.isThread()) return;
    if (channel.parentId !== NOW_PLAYING_FORUM_ID) return;
    await promptThread(channel);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    const [kind, threadId] = interaction.customId.split(":");
    if (!threadId) return;

    if (kind === "thread-link") {
      await handleLinkButton(interaction, threadId);
    } else if (kind === "thread-skip") {
      await handleSkipButton(interaction, threadId);
    }
  });

  console.log("[ThreadLinkPrompt] Service started");
}
