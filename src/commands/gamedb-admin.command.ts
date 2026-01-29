import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  ModalComponent,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { safeDeferReply, safeReply, safeUpdate, sanitizeUserInput } from "../functions/InteractionUtils.js";
import {
  performAutoAcceptImages,
  performAutoAcceptReleaseData,
  performAutoAcceptVideos,
} from "../services/GamedbAuditService.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import { isAdmin } from "./admin.command.js";
import Game, { IGame } from "../classes/Game.js";
import { setThreadGameLink } from "../classes/Thread.js";
import axios from "axios";
import { igdbService } from "../services/IgdbService.js";

const AUDIT_PAGE_SIZE = 20;
const AUDIT_VIDEO_MODAL_ID = "audit-video-modal";
const AUDIT_VIDEO_INPUT_ID = "audit-video-url";
const AUDIT_DESCRIPTION_MODAL_ID = "audit-description-modal";
const AUDIT_DESCRIPTION_INPUT_ID = "audit-description";
const AUDIT_SESSIONS = new Map<
  string,
  {
    userId: string;
    games: IGame[];
    page: number;
    filter: "all" | "image" | "thread" | "video" | "description" | "release" | "mixed";
  }
>();

function parseGameIdList(raw: string): number[] {
  const matches = raw.split(/[^0-9]+/).filter(Boolean);
  const ids = matches.map((part) => Number(part)).filter((id) => Number.isInteger(id) && id > 0);
  return Array.from(new Set(ids));
}



@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDbAdmin {
  @Slash({
    description: "Audit GameDB for missing images, threads, videos, descriptions, or release data (Admin only)",
    name: "audit",
  })
  async audit(
    @SlashOption({
      description: "Filter for missing images",
      name: "missing_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingImages: boolean | undefined,
    @SlashOption({
      description: "Filter for missing thread links",
      name: "missing_threads",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingThreads: boolean | undefined,
    @SlashOption({
      description: "Filter for missing featured videos",
      name: "missing_featured_video",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingFeaturedVideo: boolean | undefined,
    @SlashOption({
      description: "Filter for missing descriptions",
      name: "missing_descriptions",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingDescriptions: boolean | undefined,
    @SlashOption({
      description: "Filter for missing release data",
      name: "missing_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    missingReleaseData: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB images for all missing ones",
      name: "auto_accept_images",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptImages: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB featured videos for all missing ones",
      name: "auto_accept_videos",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptVideos: boolean | undefined,
    @SlashOption({
      description: "Automatically accept IGDB release data for all missing ones",
      name: "auto_accept_release_data",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    autoAcceptReleaseData: boolean | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !!showInChat;
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    if (autoAcceptImages || autoAcceptVideos || autoAcceptReleaseData) {
      if (autoAcceptImages) {
        await this.runAutoAcceptImages(
          interaction,
          isPublic,
          Boolean(autoAcceptVideos || autoAcceptReleaseData),
        );
      }
      if (autoAcceptVideos) {
        await this.runAutoAcceptVideos(
          interaction,
          isPublic,
          Boolean(autoAcceptImages || autoAcceptReleaseData),
        );
      }
      if (autoAcceptReleaseData) {
        await this.runAutoAcceptReleaseData(
          interaction,
          isPublic,
          Boolean(autoAcceptImages || autoAcceptVideos),
        );
      }
      return;
    }

    // Default to both if neither is specified, otherwise follow flags
    // If user says missing_images: true, missing_threads: false -> only images
    // If user says missing_images: true -> (missing_threads is undefined) -> treat undefined as false if one is set?
    // Let's stick to: if both undefined, check both. If one defined, follow it.
    
    let checkImages = true;
    let checkThreads = true;
    let checkFeaturedVideo = true;
    let checkDescriptions = true;
    let checkReleaseData = true;

    if (
      missingImages !== undefined ||
      missingThreads !== undefined ||
      missingFeaturedVideo !== undefined ||
      missingDescriptions !== undefined ||
      missingReleaseData !== undefined
    ) {
      checkImages = !!missingImages;
      checkThreads = !!missingThreads;
      checkFeaturedVideo = !!missingFeaturedVideo;
      checkDescriptions = !!missingDescriptions;
      checkReleaseData = !!missingReleaseData;
    }

    if (
      !checkImages &&
      !checkThreads &&
      !checkFeaturedVideo &&
      !checkDescriptions &&
      !checkReleaseData
    ) {
      await safeReply(interaction, {
        content: "You must check for at least one thing (images, threads, videos, descriptions, or release data).",
        flags: MessageFlags.Ephemeral, // Always ephemeral for errors/warnings? Or match showInChat? 
        // Typically warnings like this are okay to be ephemeral even if requested public, but let's stick to consistent visibility or force ephemeral for errors.
        // Actually, previous code forced ephemeral. Let's force ephemeral for validation errors to reduce spam.
      });
      return;
    }

    const games = await Game.getGamesForAudit(
      checkImages,
      checkThreads,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
    );

    if (games.length === 0) {
      await safeReply(interaction, {
        content: "No games found matching the audit criteria! Great job.",
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      return;
    }

    const sessionId = interaction.id;
    const filterLabel = this.buildAuditFilterLabel(
      checkImages,
      checkThreads,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
    );

    AUDIT_SESSIONS.set(sessionId, {
      userId: interaction.user.id,
      games,
      page: 0,
      filter: filterLabel,
    });

    const response = this.buildAuditListResponse(sessionId);
    await safeReply(interaction, {
      ...response,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Link alternate GameDB versions (Admin only)", name: "link-versions" })
  async linkVersions(
    @SlashOption({
      description: "Comma-separated GameDB ids to link together",
      name: "game_ids",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    gameIdsRaw: string,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const isPublic = !!showInChat;
    await safeDeferReply(interaction, { flags: isPublic ? undefined : MessageFlags.Ephemeral });

    if (!(await isAdmin(interaction))) return;

    gameIdsRaw = sanitizeUserInput(gameIdsRaw, { preserveNewlines: false });
    const gameIds = parseGameIdList(gameIdsRaw);
    if (gameIds.length < 2) {
      await safeReply(interaction, {
        content: "Provide at least two valid GameDB ids to link.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const games = await Game.getGamesByIds(gameIds);
    const foundIds = new Set(games.map((game) => game.id));
    const missingIds = gameIds.filter((id) => !foundIds.has(id));
    if (missingIds.length) {
      await safeReply(interaction, {
        content: `Missing GameDB id(s): ${missingIds.join(", ")}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await Game.linkAlternateVersions(gameIds, interaction.user.id);
    const lines = games
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((game) => `• **${game.title}** (GameDB #${game.id})`);
    const embed = new EmbedBuilder()
      .setTitle("Linked Alternate Versions")
      .setDescription(lines.join("\n"));

    await safeReply(interaction, {
      embeds: [embed],
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^audit-page:[^:]+:(next|prev)$/ })
  async handleAuditPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const direction = parts[2];

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const totalPages = Math.ceil(session.games.length / AUDIT_PAGE_SIZE);
    if (direction === "next" && session.page < totalPages - 1) {
      session.page++;
    } else if (direction === "prev" && session.page > 0) {
      session.page--;
    }

    const response = this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @SelectMenuComponent({ id: /^audit-select:[^:]+$/ })
  async handleAuditSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }

    if (session.userId !== interaction.user.id) return;

    const gameId = Number(interaction.values[0]);
    const game = session.games.find((g) => g.id === gameId);

    if (!game) {
      await safeUpdate(interaction, { content: "Game not found in session." });
      return;
    }

    const response = await this.buildAuditDetailResponse(sessionId, game);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-back:[^:]+$/ })
  async handleAuditBack(interaction: ButtonInteraction): Promise<void> {
    const sessionId = interaction.customId.split(":")[1];
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session) {
      await safeUpdate(interaction, { content: "Session expired.", components: [] });
      return;
    }
    const response = this.buildAuditListResponse(sessionId);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-next:[^:]+:\d+$/ })
  async handleAuditNext(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const currentIndex = session.games.findIndex((game) => game.id === gameId);
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    if (nextIndex >= session.games.length) {
      const response = this.buildAuditListResponse(sessionId);
      await safeUpdate(interaction, response);
      return;
    }

    const nextGame = session.games[nextIndex];
    const response = await this.buildAuditDetailResponse(sessionId, nextGame);
    await safeUpdate(interaction, response);
  }

  @ButtonComponent({ id: /^audit-accept-igdb:[^:]+:\d+$/ })
  async handleAuditAcceptIgdb(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, { content: "Invalid game or missing IGDB ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: "Fetching image from IGDB...", flags: MessageFlags.Ephemeral });

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      if (!details || !details.cover?.image_id) {
        await safeReply(interaction, { content: "Failed to find cover image on IGDB.", flags: MessageFlags.Ephemeral });
        return;
      }

      const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      const buffer = Buffer.from(resp.data);

      await Game.updateGameImage(gameId, buffer);
      
      // Update session data
      if (game) {
        game.imageData = buffer;
      }

      await safeReply(interaction, { content: "IGDB Image accepted and saved!", flags: MessageFlags.Ephemeral });

    } catch (err: any) {
      await safeReply(interaction, { content: `Error fetching IGDB image: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-img:[^:]+:\d+$/ })
  async handleAuditImage(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    
    // We need to use a collector in the channel to get the image
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeReply(interaction, {
        content: "Please upload an image (or paste a URL) for this game in the chat.",
        flags: MessageFlags.Ephemeral 
    });

    const channel = interaction.channel as any;
    if (!channel) return;

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === interaction.user.id && (m.attachments.size > 0 || m.content.length > 0),
        max: 1,
        time: 60000,
        errors: ["time"],
      });

      const msg = collected.first();
      if (!msg) return;

      let imageUrl = "";
      if (msg.attachments.size > 0) {
        imageUrl = msg.attachments.first()?.url ?? "";
      } else {
        imageUrl = msg.content.trim();
      }

      // Validate URL roughly
      if (!imageUrl.startsWith("http")) {
        await safeReply(interaction, { content: "Invalid image URL/attachment.", flags: MessageFlags.Ephemeral });
        return;
      }

      await safeReply(interaction, { content: "Processing image...", flags: MessageFlags.Ephemeral });
      
      try {
        const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const buffer = Buffer.from(resp.data);
        
        await Game.updateGameImage(gameId, buffer);
        await msg.delete().catch(() => {});

        // Update session data locally so UI reflects change if we go back/refresh
        const game = session.games.find(g => g.id === gameId);
        if (game) {
             game.imageData = buffer;
        }

        await safeReply(interaction, { content: "Image updated successfully!", flags: MessageFlags.Ephemeral });
        
        // Refresh detail view
        // We can't easily "edit" the previous interaction message from here without the interaction object flow
        // But the user can click "Back" or re-select to see changes, or we could update the message if we had access.
        // Since this is a new reply, let's just let them know.

      } catch (err: any) {
        await safeReply(interaction, { content: `Failed to update image: ${err.message}`, flags: MessageFlags.Ephemeral });
      }

    } catch {
      await safeReply(interaction, { content: "Timed out waiting for image.", flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-thread:[^:]+:\d+$/ })
  async handleAuditThread(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await safeReply(interaction, { 
        content: "Please mention the thread (e.g. <#123456>) or paste the Thread ID to link.", 
        flags: MessageFlags.Ephemeral 
    });

    const channel = interaction.channel as any;
    if (!channel) return;

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author.id === interaction.user.id,
        max: 1,
        time: 60000,
        errors: ["time"],
      });

      const msg = collected.first();
      if (!msg) return;

      const content = msg.content.trim();
      // Extract ID from mention or raw string
      const threadId = content.replace(/<#(\d+)>/, "");

      if (!/^\d+$/.test(threadId)) {
        await safeReply(interaction, { content: "Invalid Thread ID.", flags: MessageFlags.Ephemeral });
        return;
      }

      await safeReply(interaction, { content: "Linking thread...", flags: MessageFlags.Ephemeral });

      try {
        await setThreadGameLink(threadId, gameId);
        await msg.delete().catch(() => {});
        await safeReply(interaction, { content: "Thread linked successfully!", flags: MessageFlags.Ephemeral });
        
        // Remove from session list if checking threads? 
        // Or just let it be. simpler to leave it.

      } catch (err: any) {
        await safeReply(interaction, { content: `Failed to link thread: ${err.message}`, flags: MessageFlags.Ephemeral });
      }

    } catch {
        await safeReply(interaction, { content: "Timed out waiting for thread ID.", flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-accept-video:[^:]+:\d+$/ })
  async handleAuditAcceptVideo(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);

    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const game = session.games.find(g => g.id === gameId);
    if (!game || !game.igdbId) {
      await safeReply(interaction, { content: "Invalid game or missing IGDB ID.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    try {
      const details = await igdbService.getGameDetails(game.igdbId);
      const videoUrl = details ? Game.getFeaturedVideoUrl(details) : null;
      if (!videoUrl) {
        await safeReply(interaction, { content: "No featured video found on IGDB.", flags: MessageFlags.Ephemeral });
        return;
      }

      await Game.updateFeaturedVideoUrl(gameId, videoUrl);
      game.featuredVideoUrl = videoUrl;
      if (session.filter === "video") {
        session.games = session.games.filter((entry) => entry.id !== gameId);
      }

      const refreshed = await Game.getGameById(gameId);
      if (refreshed) {
        const response = await this.buildAuditDetailResponse(sessionId, refreshed);
        await safeUpdate(interaction, response);
      }

      // no extra success message
    } catch (err: any) {
      await safeReply(interaction, { content: `Error fetching featured video: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
  }

  @ButtonComponent({ id: /^audit-video:[^:]+:\d+$/ })
  async handleAuditVideo(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_VIDEO_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add YouTube Video")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(AUDIT_VIDEO_INPUT_ID)
            .setLabel("YouTube URL")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder("https://www.youtube.com/watch?v=..."),
        ),
      );

    await interaction.showModal(modal).catch(() => {});
  }

  @ButtonComponent({ id: /^audit-description:[^:]+:\d+$/ })
  async handleAuditDescription(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    const modal = new ModalBuilder()
      .setCustomId(`${AUDIT_DESCRIPTION_MODAL_ID}:${sessionId}:${gameIdStr}`)
      .setTitle("Add Description")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(AUDIT_DESCRIPTION_INPUT_ID)
            .setLabel("Description")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
      );

    await interaction.showModal(modal).catch(() => {});
  }

  @ModalComponent({ id: /^audit-video-modal:[^:]+:\d+$/ })
  async handleAuditVideoModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const rawUrl = interaction.fields.getTextInputValue(AUDIT_VIDEO_INPUT_ID);
    const videoUrl = sanitizeUserInput(rawUrl, { preserveNewlines: false });
    if (!videoUrl || !videoUrl.startsWith("http")) {
      await interaction.editReply({ content: "Please provide a valid YouTube URL." });
      return;
    }

    await Game.updateFeaturedVideoUrl(gameId, videoUrl);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.featuredVideoUrl = videoUrl;
    }
    if (session.filter === "video") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      await interaction.message.edit(response).catch(() => {});
    }

    await interaction.deleteReply().catch(() => {});
  }

  @ModalComponent({ id: /^audit-description-modal:[^:]+:\d+$/ })
  async handleAuditDescriptionModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, sessionId, gameIdStr] = interaction.customId.split(":");
    const gameId = Number(gameIdStr);
    const session = AUDIT_SESSIONS.get(sessionId);
    if (!session || session.userId !== interaction.user.id) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const rawDescription = interaction.fields.getTextInputValue(AUDIT_DESCRIPTION_INPUT_ID);
    const description = sanitizeUserInput(rawDescription, { preserveNewlines: true });
    if (!description) {
      await interaction.editReply({ content: "Please provide a valid description." });
      return;
    }

    await Game.updateGameDescription(gameId, description);

    const sessionGame = session.games.find((game) => game.id === gameId);
    if (sessionGame) {
      sessionGame.description = description;
    }
    if (session.filter === "description") {
      session.games = session.games.filter((entry) => entry.id !== gameId);
    }

    const refreshed = await Game.getGameById(gameId);
    if (refreshed && interaction.message) {
      const response = await this.buildAuditDetailResponse(sessionId, refreshed);
      await interaction.message.edit(response).catch(() => {});
    }

    await interaction.deleteReply().catch(() => {});
  }

  private buildAuditFilterLabel(
    checkImages: boolean,
    checkThreads: boolean,
    checkFeaturedVideo: boolean,
    checkDescriptions: boolean,
    checkReleaseData: boolean,
  ): "all" | "image" | "thread" | "video" | "description" | "release" | "mixed" {
    const enabled = [
      checkImages,
      checkThreads,
      checkFeaturedVideo,
      checkDescriptions,
      checkReleaseData,
    ].filter(Boolean).length;
    if (enabled === 5) return "all";
    if (enabled === 1) {
      if (checkImages) return "image";
      if (checkThreads) return "thread";
      if (checkFeaturedVideo) return "video";
      if (checkDescriptions) return "description";
      return "release";
    }
    return "mixed";
  }

  private buildAuditListResponse(sessionId: string) {
    const session = AUDIT_SESSIONS.get(sessionId)!;
    const { games, page } = session;

    const totalPages = Math.ceil(games.length / AUDIT_PAGE_SIZE);
    const start = page * AUDIT_PAGE_SIZE;
    const end = start + AUDIT_PAGE_SIZE;
    const slice = games.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle(`GameDB Audit (${session.filter})`)
      .setDescription(
        `Showing items ${start + 1}-${Math.min(end, games.length)} of ${games.length}\n\n` +
        slice.map((g) => {
          const imageStatus = g.imageData ? "✅Img" : "❌Img";
          const videoStatus = g.featuredVideoUrl ? "✅Vid" : "❌Vid";
          const descStatus = g.description ? "✅Desc" : "❌Desc";
          const releaseStatus = g.initialReleaseDate ? "✅Rel" : "❌Rel";
          return `• **${g.title}** (ID: ${g.id}) ` +
            `${imageStatus} ${videoStatus} ${descStatus} ${releaseStatus}`;
        }).join("\n")
      )
      .setFooter({ text: `Page ${page + 1}/${totalPages}` });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`audit-select:${sessionId}`)
      .setPlaceholder("Select a game to audit")
      .addOptions(
        slice.map(g => ({
          label: g.title.substring(0, 100),
          value: String(g.id),
          description: `ID: ${g.id}`,
        }))
      );

    const prevDisabled = page === 0;
    const nextDisabled = page >= totalPages - 1;

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-page:${sessionId}:prev`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(prevDisabled),
      new ButtonBuilder()
        .setCustomId(`audit-page:${sessionId}:next`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(nextDisabled)
    );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const components: ActionRowBuilder<any>[] = [row];
    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttons);
    }

    return {
      embeds: [embed],
      components,
      files: []
    };
  }

  private async buildAuditDetailResponse(sessionId: string, game: IGame) {
    const embed = new EmbedBuilder()
      .setTitle(`Audit: ${game.title}`)
      .setDescription(`Game ID: ${game.id}\nIGDB ID: ${game.igdbId ?? "N/A"}`)
      .setColor(0xFFA500); // Orange for audit

    const files: AttachmentBuilder[] = [];

    let igdbImageAvailable = false;
    let igdbImageUrl = "";
    let igdbVideoUrl: string | null = null;
    let igdbDetailsLoaded = false;

    // Check IGDB for image if missing
    if ((!game.imageData || !game.featuredVideoUrl) && game.igdbId) {
      try {
        const details = await igdbService.getGameDetails(game.igdbId);
        igdbDetailsLoaded = true;
        if (!game.imageData && details?.cover?.image_id) {
          igdbImageAvailable = true;
          igdbImageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
          embed.addFields({
            name: "IGDB Suggestion",
            value: "[Link to Image](" + igdbImageUrl + ")",
            inline: true,
          });
        }
        if (details && !game.featuredVideoUrl) {
          igdbVideoUrl = Game.getFeaturedVideoUrl(details);
        }
      } catch {
        // ignore
      }
    }

    if (game.imageData) {
        embed.addFields({ name: "Image", value: "✅ Present", inline: true });
        // Optionally show it
        const attach = new AttachmentBuilder(game.imageData, { name: "cover.jpg" });
        files.push(attach);
        embed.setImage("attachment://cover.jpg");
    } else {
        embed.addFields({ name: "Image", value: "❌ Missing", inline: true });
    }

    if (game.featuredVideoUrl) {
        embed.addFields({ name: "Featured Video", value: "✅ Present", inline: true });
    } else {
        embed.addFields({ name: "Featured Video", value: "❌ Missing", inline: true });
    }

    if (game.description) {
      embed.addFields({ name: "Description", value: "✅ Present", inline: true });
    } else {
      embed.addFields({ name: "Description", value: "❌ Missing", inline: true });
    }

    const releases = await Game.getGameReleases(game.id);
    if (releases.length) {
      embed.addFields({
        name: "Release Data",
        value: `✅ ${releases.length} release${releases.length === 1 ? "" : "s"}`,
        inline: true,
      });
    } else {
      embed.addFields({ name: "Release Data", value: "❌ Missing", inline: true });
    }

    // Check thread link
    const associations = await Game.getGameAssociations(game.id);
    const nowPlaying = await Game.getNowPlayingMembers(game.id); // Also checks for thread links in its query
    
    // Find any thread
    const threadId = 
        associations.gotmWins.find(w => w.threadId)?.threadId ??
        associations.nrGotmWins.find(w => w.threadId)?.threadId ??
        nowPlaying.find(p => p.threadId)?.threadId;

    if (threadId) {
        embed.addFields({ name: "Thread", value: `✅ <#${threadId}>`, inline: true });
    } else {
        embed.addFields({ name: "Thread", value: "❌ Missing", inline: true });
    }

    const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-back:${sessionId}`)
        .setLabel("Back to List")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`audit-next:${sessionId}:${game.id}`)
        .setLabel("Go to Next Game")
        .setStyle(ButtonStyle.Secondary),
    );

    const actionRow = new ActionRowBuilder<ButtonBuilder>();
    if (!game.imageData && igdbImageAvailable) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`audit-accept-igdb:${sessionId}:${game.id}`)
          .setLabel("Accept IGDB Image")
          .setStyle(ButtonStyle.Success),
      );
    }

    if (!game.featuredVideoUrl && (igdbVideoUrl || igdbDetailsLoaded)) {
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`audit-accept-video:${sessionId}:${game.id}`)
          .setLabel("Accept IGDB Video")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!igdbVideoUrl),
      );
    }

    const session = AUDIT_SESSIONS.get(sessionId);
    if (session) {
      if (!game.featuredVideoUrl && ["video", "mixed", "all"].includes(session.filter)) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`audit-video:${sessionId}:${game.id}`)
            .setLabel("Add YouTube Video")
            .setStyle(ButtonStyle.Primary),
        );
      }
      if (!game.description && ["description", "mixed", "all"].includes(session.filter)) {
        actionRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`audit-description:${sessionId}:${game.id}`)
            .setLabel("Add Description")
            .setStyle(ButtonStyle.Primary),
        );
      }
    }

    const editRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`audit-img:${sessionId}:${game.id}`)
        .setLabel("Upload Image")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`audit-thread:${sessionId}:${game.id}`)
        .setLabel("Link Thread")
        .setStyle(ButtonStyle.Success),
    );

    const components: ActionRowBuilder<ButtonBuilder>[] = [navRow];
    if (actionRow.components.length) {
      components.push(actionRow);
    }
    components.push(editRow);

    return {
      embeds: [embed],
      components,
      files: files.length ? files : undefined,
    };
  }

  private async runAutoAcceptImages(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Images")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);

    await safeReply(interaction, {
      embeds: [embed],
      __forceFollowUp: useFollowUp,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });

    const logLines: string[] = [];
    const updateEmbed = async (log?: string) => {
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      embed.setDescription(content || "Processing...");
      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptImages(updateEmbed);
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing images and valid IGDB IDs.",
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    embed.setColor(0x2ecc71);
    await interaction.editReply({ embeds: [embed] });
  }

  private async runAutoAcceptVideos(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Videos")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);

    await safeReply(interaction, {
      embeds: [embed],
      __forceFollowUp: useFollowUp,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });

    const logLines: string[] = [];
    const updateEmbed = async (log?: string) => {
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      embed.setDescription(content || "Processing...");
      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptVideos(updateEmbed);
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing featured videos and valid IGDB IDs.",
        __forceFollowUp: useFollowUp,
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    embed.setColor(0x2ecc71);
    await interaction.editReply({ embeds: [embed] });
  }

  private async runAutoAcceptReleaseData(
    interaction: CommandInteraction,
    isPublic: boolean,
    useFollowUp: boolean,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setTitle("Auto-Accept IGDB Release Data")
      .setDescription("Starting auto accept run...")
      .setColor(0x0099ff);

    await safeReply(interaction, {
      embeds: [embed],
      __forceFollowUp: useFollowUp,
      flags: isPublic ? undefined : MessageFlags.Ephemeral,
    });

    const logLines: string[] = [];
    const updateEmbed = async (log?: string) => {
      if (log) {
        logLines.push(log);
      }

      let content = logLines.join("\n");
      while (content.length > 3500) {
        logLines.shift();
        content = logLines.join("\n");
      }

      embed.setDescription(content || "Processing...");
      try {
        await interaction.editReply({ embeds: [embed] });
      } catch {
        // ignore
      }
    };

    const { updated, skipped, failed, logs } = await performAutoAcceptReleaseData(updateEmbed);
    if (!logs.length) {
      await safeReply(interaction, {
        content: "No games found with missing release data and valid IGDB IDs.",
        __forceFollowUp: useFollowUp,
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      return;
    }

    const summary =
      `\n**Run Complete**\n✅ Updated: ${updated}\n` +
      `⏭️ Skipped: ${skipped}\n❌ Failed: ${failed}`;
    await updateEmbed(summary);
    embed.setColor(0x2ecc71);
    await interaction.editReply({ embeds: [embed] });
  }
}
