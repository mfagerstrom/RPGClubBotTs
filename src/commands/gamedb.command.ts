import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  type Message,
  AttachmentBuilder,
  escapeCodeBlock,
  MessageFlags,
} from "discord.js";
import { readFileSync } from "fs";
import path from "path";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game, { type IGameAssociationSummary } from "../classes/Game.js";
import axios from "axios"; // For downloading image attachments
import { igdbService } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";

const GAME_SEARCH_PAGE_SIZE = 25;
const GAME_SEARCH_SESSIONS = new Map<
  string,
  { userId: string; results: any[]; query: string }
>();

function isUniqueConstraintError(err: any): boolean {
  const msg = err?.message ?? "";
  return /ORA-00001/i.test(msg) || /unique constraint/i.test(msg);
}

function isUnknownWebhookError(err: any): boolean {
  const code = err?.code ?? err?.rawError?.code;
  return code === 10015;
}

const GAME_DB_THUMB_NAME = "gameDB.png";
const GAME_DB_THUMB_PATH = path.join(
  process.cwd(),
  "src",
  "assets",
  "images",
  GAME_DB_THUMB_NAME,
);
const gameDbThumbBuffer = readFileSync(GAME_DB_THUMB_PATH);

function buildGameDbThumbAttachment(): AttachmentBuilder {
  return new AttachmentBuilder(gameDbThumbBuffer, { name: GAME_DB_THUMB_NAME });
}

function applyGameDbThumbnail(embed: EmbedBuilder): EmbedBuilder {
  return embed.setThumbnail(`attachment://${GAME_DB_THUMB_NAME}`);
}

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDb {
  @Slash({ description: "Add a new game to the database (searches IGDB)", name: "add" })
  async add(
    @SlashOption({
      description: "Title of the game to search for",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    title: string | undefined,
    @SlashOption({
      description: "IGDB id (skip search and import directly)",
      name: "igdb_id",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    igdbId: number | undefined,
    @SlashOption({
      description: "Comma-separated list of up to 5 titles to import",
      name: "bulk_titles",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    bulkTitles: string | undefined,
    @SlashOption({
      description: "Include raw IGDB search JSON attachment",
      name: "include_raw",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    includeRaw: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (igdbId) {
      await this.addGameToDatabase(interaction, Number(igdbId), { selectionMessage: null });
      return;
    }

    const parsedBulk =
      bulkTitles?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];
    const singleTitle = title?.trim() ?? "";
    const allTitles =
      (singleTitle ? [singleTitle] : []).concat(parsedBulk).filter(Boolean);

    if (!allTitles.length) {
      await safeReply(interaction, {
        content: "Provide a title or up to 5 comma-separated titles.",
      });
      return;
    }

    if (allTitles.length > 5) {
      await safeReply(interaction, {
        content: "Bulk import supports up to 5 titles at a time.",
      });
      return;
    }

    for (const t of allTitles) {
      await this.processTitle(interaction, t, includeRaw ?? false);
    }
  }

  private async handleNoResults(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    query: string,
  ): Promise<void> {
    try {
      // If something was added concurrently, surface nearby matches while prompting IGDB import.
      const existing = await Game.searchGames(query);
      const existingList = existing
        .slice(0, 10)
        .map((g) => `• **${g.title}** (GameDB #${g.id})`);
      const existingText = existingList.length
        ? `${existingList.join("\n")}${existing.length > 10 ? "\n(and more...)" : ""}`
        : null;

      const searchRes = await igdbService.searchGames(query);
      const results = searchRes.results;

      if (!results.length) {
        await safeReply(interaction, {
          content: existingText
            ? `No games found on IGDB matching "${query}".\nSimilar GameDB entries:\n${existingText}`
            : `No games found on IGDB matching "${query}".`,
          __forceFollowUp: true,
        });
        return;
      }

      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id, { selectionMessage: null });
        return;
      }

      const opts: IgdbSelectOption[] = results.map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          id: game.id,
          label: `${game.name} (${year})`,
          description: (game.summary || "No summary").substring(0, 95),
        };
      });

      const { components } = createIgdbSession(
        interaction.user.id,
        opts,
        async (sel, igdbId) => {
          if (!sel.deferred && !sel.replied) {
            await sel.deferUpdate().catch(() => {});
          }
          await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
        },
      );

      const totalLabel =
        typeof searchRes.total === "number" ? searchRes.total : results.length;
      const needsPaging = totalLabel > 22;
      const pagingHint = needsPaging
        ? "\nUse the dropdown's Next page option to see more results."
        : "";

      const embed = new EmbedBuilder().setDescription(
        `Found ${totalLabel} results for "${query}". Showing first ${Math.min(
          results.length,
          22,
        )}.${pagingHint ? ` ${pagingHint}` : ""}`,
      );

      if (existingText) {
        embed.addFields({
          name: "Existing GameDB matches",
          value: existingText.slice(0, 1024),
        });
      }

      await safeReply(interaction, {
        embeds: [embed],
        components,
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: `Auto-import failed: ${err?.message ?? err}`,
        __forceFollowUp: true,
      });
    }
  }
  @Slash({ description: "Dump raw IGDB API data for a title", name: "igdb_api_dump" })
  async igdbApiDump(
    @SlashOption({
      description: "Title to query on IGDB",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const searchRes = await igdbService.searchGames(title, 50, true);
      const results = searchRes.results;
      if (!results?.length) {
        await safeReply(interaction, {
          content: `No IGDB results for "${title}".`,
          __forceFollowUp: true,
        });
        return;
      }

      const json = JSON.stringify(results, null, 2);
      const sanitized = escapeCodeBlock ? escapeCodeBlock(json) : json;
      const attachment = new AttachmentBuilder(Buffer.from(json, "utf8"), {
        name: "igdb-response.json",
      });
      const maxPreview = 1500;
      const preview =
        sanitized.length > maxPreview ? `${sanitized.slice(0, maxPreview)}...\n(truncated)` : sanitized;

      await safeReply(interaction, {
        content:
          `Found ${results.length} IGDB result(s) for "${title}".\n` +
          `\`\`\`json\n${preview}\n\`\`\`\nFull array attached as igdb-response.json.`,
        files: [attachment],
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: `Failed to fetch IGDB data: ${err?.message ?? err}`,
        __forceFollowUp: true,
      });
    }
  }

  private async processTitle(
    interaction: CommandInteraction,
    title: string,
    includeRaw: boolean = false,
  ): Promise<void> {
    try {
      // 1. Search IGDB
      const searchRes = includeRaw
        ? await igdbService.searchGames(title, undefined, true)
        : await igdbService.searchGames(title);
      const results = searchRes.results;

      if (!results || results.length === 0) {
        await this.handleNoResults(interaction, title);
        return;
      }

      // 1b. Single Result - Auto Add
      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id, { selectionMessage: null });
        return;
      }

      // 2. Build Select Menu
    const opts: IgdbSelectOption[] = results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description: (game.summary || "No summary").substring(0, 95),
      };
    });

    const attachment = includeRaw && searchRes.raw
      ? new AttachmentBuilder(Buffer.from(JSON.stringify(searchRes.raw, null, 2), "utf8"), {
          name: "igdb-search.json",
        })
      : null;

    const { components } = createIgdbSession(
      interaction.user.id,
      opts,
      async (sel, igdbId) => {
        if (!sel.deferred && !sel.replied) {
          await sel.deferUpdate().catch(() => {});
        }
        await this.addGameToDatabase(sel, igdbId, { selectionMessage: sel.message as any });
      },
    );

    await safeReply(interaction, {
      content: `Found ${results.length} results for "${title}". Please select one:`,
      components,
      files: attachment ? [attachment] : undefined,
      __forceFollowUp: true,
    });

    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search IGDB. Error: ${error.message}`,
      });
    }
  }

  private async addGameToDatabase(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    igdbId: number,
    opts?: { selectionMessage?: Message | null },
  ): Promise<void> {
    // 4. Fetch Details
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      // followUp for components, editReply for command interactions.
      const msg = "Failed to fetch details from IGDB.";
      const payload = { content: msg };
      try {
        if (interaction.isMessageComponent()) {
          await interaction.followUp(payload);
        } else {
          await interaction.editReply(payload);
        }
      } catch (err) {
        if (isUnknownWebhookError(err)) {
          await safeReply(interaction, { ...payload, __forceFollowUp: true });
        } else {
          throw err;
        }
      }
      return;
    }

    // 5. Download Image
    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const imageUrl =
          `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        imageData = Buffer.from(imageResponse.data);
      } catch (err) {
        console.error("Failed to download cover image:", err);
        // Proceed without image
      }
    }

    // 6. Save to DB
    const igdbUrl = details.url
      || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);
    let newGame;
    try {
      newGame = await Game.createGame(
        details.name,
        details.summary || null,
        imageData,
        details.id,
        details.slug,
        details.total_rating ?? null,
        igdbUrl,
      );
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        const msg = "This game has already been imported.";
        const payload = { content: msg };
        try {
          if (interaction.isMessageComponent()) {
            await interaction.followUp(payload);
          } else {
            await interaction.editReply(payload);
          }
        } catch (e) {
          if (isUnknownWebhookError(e)) {
            await safeReply(interaction, { ...payload, __forceFollowUp: true });
          } else {
            throw e;
          }
        }
        return;
      }
      throw err;
    }

    // 6a. Save Extended Metadata
    await Game.saveFullGameMetadata(newGame.id, details);

    // 6b. Process Releases
    await this.processReleaseDates(
      newGame.id,
      details.release_dates || [],
      details.platforms || [],
    );

    // Clean up selection menu if present
    if (opts?.selectionMessage) {
      try {
        await opts.selectionMessage.edit({ components: [] });
      } catch {
        // ignore cleanup failures
      }
    }

    // 7. Final Success Message with embed left in chat
    const embed = new EmbedBuilder()
      .setTitle(`Added to GameDB: ${newGame.title}`)
      .setDescription(`GameDB ID: ${newGame.id}${igdbUrl ? `\nIGDB: ${igdbUrl}` : ""}`)
      .setColor(0x0099ff);
    applyGameDbThumbnail(embed);
    const attachments: AttachmentBuilder[] = [buildGameDbThumbAttachment()];
    if (imageData) {
      embed.setImage("attachment://cover.jpg");
      attachments.push(new AttachmentBuilder(imageData, { name: "cover.jpg" }));
    }
    await safeReply(interaction, {
      content: `Successfully added **${newGame.title}** (ID: ${newGame.id}) to the database!`,
      embeds: [embed],
      files: attachments,
      __forceFollowUp: true,
    });
  }

  @Slash({ description: "View details of a game", name: "view" })
  async view(
    @SlashOption({
      description: "ID of the game to view",
      name: "game_id",
      required: false,
      type: ApplicationCommandOptionType.Number,
    })
    gameId: number,
    @SlashOption({
      description: "Search query (falls back to search flow if no ID provided)",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (Number.isFinite(gameId)) {
      await this.showGameProfile(interaction, gameId);
      return;
    }

    const searchTerm = (query ?? "").trim();
    if (!searchTerm) {
      await safeReply(interaction, {
        content: "Provide a game_id or a search query.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.runSearchFlow(interaction, searchTerm);
  }

  private async showGameProfile(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    gameId: number,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await safeReply(interaction, {
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      embeds: profile.embeds,
      files: profile.files,
    });
  }

  private async buildGameProfile(
    gameId: number,
    interaction?: CommandInteraction | StringSelectMenuInteraction,
  ): Promise<{ embeds: EmbedBuilder[]; files: AttachmentBuilder[] } | null> {
    try {
      const game = await Game.getGameById(gameId);
      if (!game) {
        return null;
      }

      const releases = await Game.getGameReleases(gameId);
      const platforms = await Game.getAllPlatforms();
      const regions = await Game.getAllRegions();
      const associations = await Game.getGameAssociations(gameId);
      const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
      const completions = await Game.getGameCompletions(gameId);

      const platformMap = new Map(platforms.map((p) => [p.id, p.name]));
      const regionMap = new Map(regions.map((r) => [r.id, r.name]));

      const description = game.description || "No description available.";

      const embed = new EmbedBuilder()
        .setTitle(`${game.title} (GameDB #${game.id})`)
        .setColor(0x0099ff);

      if (game.igdbUrl) {
        embed.setURL(game.igdbUrl);
      }
      applyGameDbThumbnail(embed);

      // Keep the win/round info up top in the single embed
      if (associations.gotmWins.length) {
        const lines = associations.gotmWins.map((win) => `Round ${win.round}`);
        embed.addFields({ name: "GOTM Round(s)", value: lines.join("\n"), inline: true });
      }

      if (associations.nrGotmWins.length) {
        const lines = associations.nrGotmWins.map((win) => `Round ${win.round}`);
        embed.addFields({ name: "NR-GOTM Round(s)", value: lines.join("\n"), inline: true });
      }

      // Thread / Reddit links as their own fields
      const threadId =
        associations.gotmWins.find((w) => w.threadId)?.threadId ??
        associations.nrGotmWins.find((w) => w.threadId)?.threadId ??
        nowPlayingMembers.find((p) => p.threadId)?.threadId ??
        null;
      if (threadId) {
        const threadLabel = await this.buildThreadLink(
          threadId,
          interaction?.guildId ?? null,
          interaction?.client as any,
        );
        embed.addFields({
          name: "Game Discussion Thread",
          value: threadLabel ?? `[Thread Link](https://discord.com/channels/@me/${threadId})`,
          inline: true,
        });
      }

      const redditUrlRaw =
        associations.gotmWins.find((w) => w.redditUrl)?.redditUrl ??
        associations.nrGotmWins.find((w) => w.redditUrl)?.redditUrl ??
        null;
      const redditUrl = redditUrlRaw === "__NO_VALUE__" ? null : redditUrlRaw;
      if (redditUrl) {
        embed.addFields({
          name: "Reddit Discussion Thread",
          value: `[Reddit Link](${redditUrl})`,
          inline: true,
        });
      }

      if (nowPlayingMembers.length) {
        const MAX_NOW_PLAYING_DISPLAY = 12;
        const lines = nowPlayingMembers.slice(0, MAX_NOW_PLAYING_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return `${name} (<@${member.userId}>)`;
        });

        if (nowPlayingMembers.length > MAX_NOW_PLAYING_DISPLAY) {
          const remaining = nowPlayingMembers.length - MAX_NOW_PLAYING_DISPLAY;
          lines.push(`…and ${remaining} more playing now.`);
        }

        embed.addFields({
          name: "Now Playing",
          value: lines.join("\n"),
          inline: true,
        });
      }

      if (completions.length) {
        const MAX_COMPLETIONS_DISPLAY = 12;
        const lines = completions.slice(0, MAX_COMPLETIONS_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return `${name} (<@${member.userId}>) — ${member.completionType}`;
        });

        if (completions.length > MAX_COMPLETIONS_DISPLAY) {
          const remaining = completions.length - MAX_COMPLETIONS_DISPLAY;
          lines.push(`…and ${remaining} more completed this.`);
        }

        embed.addFields({
          name: "Completed By",
          value: lines.join("\n"),
          inline: true,
        });
      }

      // Remaining association info (nominations) goes here before description
      this.appendAssociationFields(embed, {
        ...associations,
        gotmWins: [],
        nrGotmWins: [],
      });

      // Description comes after rounds/links/nominations to keep those at the top
      const descChunks = this.chunkText(description, 1024);
      descChunks.forEach((chunk, idx) => {
        embed.addFields({
          name: idx === 0 ? "Description" : `Description (cont. ${idx + 1})`,
          value: chunk,
          inline: false,
        });
      });

      if (releases.length > 0) {
        const releaseField = releases
          .map((r) => {
            const platformName = platformMap.get(r.platformId) || "Unknown Platform";
            const regionName = regionMap.get(r.regionId) || "Unknown Region";
            const releaseDate = r.releaseDate ? r.releaseDate.toLocaleDateString() : "TBD";
          const format = r.format ? `(${r.format})` : "";
          return `• **${platformName}** (${regionName}) ${format} - ${releaseDate}`;
        })
          .join("\n");
        embed.addFields({ name: "Releases", value: releaseField, inline: false });
      }

      const developers = await Game.getGameDevelopers(gameId);
      if (developers.length) {
        embed.addFields({ name: "Developers", value: developers.join(", "), inline: true });
      }

      const publishers = await Game.getGamePublishers(gameId);
      if (publishers.length) {
        embed.addFields({ name: "Publishers", value: publishers.join(", "), inline: true });
      }

      const genres = await Game.getGameGenres(gameId);
      if (genres.length) {
        embed.addFields({ name: "Genres", value: genres.join(", "), inline: true });
      }

      const themes = await Game.getGameThemes(gameId);
      if (themes.length) {
        embed.addFields({ name: "Themes", value: themes.join(", "), inline: true });
      }

      const modes = await Game.getGameModes(gameId);
      if (modes.length) {
        embed.addFields({ name: "Game Modes", value: modes.join(", "), inline: true });
      }

      const perspectives = await Game.getGamePerspectives(gameId);
      if (perspectives.length) {
        embed.addFields({
          name: "Player Perspectives",
          value: perspectives.join(", "),
          inline: true,
        });
      }

      const engines = await Game.getGameEngines(gameId);
      if (engines.length) {
        embed.addFields({ name: "Game Engines", value: engines.join(", "), inline: true });
      }

      const franchises = await Game.getGameFranchises(gameId);
      if (franchises.length) {
        embed.addFields({ name: "Franchises", value: franchises.join(", "), inline: true });
      }

      const series = await Game.getGameSeries(gameId);
      if (series) {
        embed.addFields({ name: "Series / Collection", value: series, inline: true });
      }

      if (game.totalRating) {
        embed.addFields({
          name: "IGDB Rating",
          value: `${Math.round(game.totalRating)}/100`,
          inline: true,
        });
      }

      const files: AttachmentBuilder[] = [buildGameDbThumbAttachment()];
      if (game.imageData) {
        files.push(new AttachmentBuilder(game.imageData, { name: "game_image.png" }));
      }

      return { embeds: [embed], files };
    } catch (error: any) {
      console.error("Failed to build game profile:", error);
      return null;
    }
  }

  private chunkText(text: string, size: number): string[] {
    if (!text) return ["No description available."];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks;
  }

  private async buildThreadLink(
    threadId: string,
    guildId: string | null,
    client: any,
  ): Promise<string | null> {
    if (!client || !guildId) {
      return null;
    }
    try {
      const channel = await client.channels.fetch(threadId);
      const name = (channel as any)?.name || "Thread Link";
      return `[${name}](https://discord.com/channels/${guildId}/${threadId})`;
    } catch {
      return null;
    }
  }

  // Helper to process release dates
  private async processReleaseDates(
    gameId: number,
    releaseDates: any[],
    platforms: { id: number; name: string }[],
  ): Promise<void> {
    if (!releaseDates || !Array.isArray(releaseDates)) {
      return;
    }

    for (const release of releaseDates) {
      const platformId: number | null = typeof release.platform === "number"
        ? release.platform
        : (release.platform?.id ?? null);
      const platformName: string | null = typeof release.platform === "object"
        ? (release.platform?.name ?? null)
        : (platforms.find((p) => p.id === platformId)?.name ?? null);
      if (!platformId || !release.region) {
        continue;
      }

      const platform = await Game.ensurePlatform({ id: platformId, name: platformName });
      const region = await Game.ensureRegion(release.region);

      if (!platform || !region) {
        continue;
      }

      try {
        await Game.addReleaseInfo(
          gameId,
          platform.id,
          region.id,
          "Physical",
          release.date ? new Date(release.date * 1000) : null,
          null,
        );
      } catch (err) {
        console.error(`Failed to add release for game ${gameId}:`, err);
      }
    }
  }

  private appendAssociationFields(embed: EmbedBuilder, assoc: IGameAssociationSummary): void {
    if (assoc.gotmWins.length) {
      const lines = assoc.gotmWins.map((win) => {
        const thread = win.threadId ? ` — Thread: <#${win.threadId}>` : "";
        const reddit = win.redditUrl ? ` — [Reddit](${win.redditUrl})` : "";
        return `Round ${win.round}${thread}${reddit}`;
      });
      embed.addFields({ name: "GOTM Round(s)", value: lines.join("\n"), inline: true });
    }

    if (assoc.nrGotmWins.length) {
      const lines = assoc.nrGotmWins.map((win) => {
        const thread = win.threadId ? ` — Thread: <#${win.threadId}>` : "";
        const reddit = win.redditUrl ? ` — [Reddit](${win.redditUrl})` : "";
        return `Round ${win.round}${thread}${reddit}`;
      });
      embed.addFields({ name: "NR-GOTM Round(s)", value: lines.join("\n"), inline: true });
    }

    if (assoc.gotmNominations.length) {
      const lines = assoc.gotmNominations.map(
        (nom) => `Round ${nom.round} — ${nom.username} (<@${nom.userId}>)`,
      );
      embed.addFields({ name: "GOTM Nominations", value: lines.join("\n"), inline: true });
    }

    if (assoc.nrGotmNominations.length) {
      const lines = assoc.nrGotmNominations.map(
        (nom) => `Round ${nom.round} — ${nom.username} (<@${nom.userId}>)`,
      );
      embed.addFields({ name: "NR-GOTM Nominations", value: lines.join("\n"), inline: true });
    }
  }

  @Slash({ description: "Search for a game", name: "search" })
  async search(
    @SlashOption({
      description: "Search query (game title). Leave empty to list all.",
      name: "title",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const searchTerm = (query ?? "").trim();
      await this.runSearchFlow(interaction, searchTerm, query);
    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search games. Error: ${error.message}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private async runSearchFlow(
    interaction: CommandInteraction,
    searchTerm: string,
    rawQuery?: string,
  ): Promise<void> {
    const results = await Game.searchGames(searchTerm);

    if (results.length === 0) {
      await this.handleNoResults(interaction, searchTerm || rawQuery || "Unknown");
      return;
    }

    if (results.length === 1) {
      await this.showGameProfile(interaction, results[0].id);
      return;
    }

    const sessionId = interaction.id;
    GAME_SEARCH_SESSIONS.set(sessionId, {
      userId: interaction.user.id,
      results,
      query: searchTerm,
    });

    const response = this.buildSearchResponse(sessionId, GAME_SEARCH_SESSIONS.get(sessionId)!, 0);

    await safeReply(interaction, response);
  }

  @SelectMenuComponent({ id: /^gamedb-search-select:[^:]+:\d+:\d+$/ })
  async handleSearchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const ownerId = parts[2];
    const page = Number(parts[3]);

    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const session = GAME_SEARCH_SESSIONS.get(sessionId);
    if (!session) {
      await interaction
        .reply({
          content: "This search session has expired.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const gameId = Number(interaction.values?.[0]);
    if (!Number.isFinite(gameId)) {
      await interaction
        .reply({
          content: "Invalid selection.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await interaction
        .followUp({
          content: "Unable to load that game.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const response = this.buildSearchResponse(sessionId, session, page);

    try {
      await interaction.editReply({
        embeds: profile.embeds,
        files: profile.files,
        components: response.components,
        content: null as any,
      });
    } catch {
      // ignore update failures
    }
  }

  @ButtonComponent({ id: /^gamedb-search-page:[^:]+:\d+:\d+:(next|prev)$/ })
  async handleSearchPage(interaction: ButtonInteraction): Promise<void> {
    const parts = interaction.customId.split(":");
    const sessionId = parts[1];
    const ownerId = parts[2];
    const page = Number(parts[3]);
    const direction = parts[4];

    if (interaction.user.id !== ownerId) {
      await interaction
        .reply({
          content: "This menu isn't for you.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const session = GAME_SEARCH_SESSIONS.get(sessionId);
    if (!session) {
      await interaction
        .reply({
          content: "This search session has expired.",
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    const totalPages = Math.max(
      1,
      Math.ceil(session.results.length / GAME_SEARCH_PAGE_SIZE),
    );
    const delta = direction === "next" ? 1 : -1;
    const newPage = Math.min(Math.max(page + delta, 0), totalPages - 1);

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const response = this.buildSearchResponse(sessionId, session, newPage);

    try {
      await interaction.editReply({
        ...response,
        files: response.files,
        content: null as any,
      });
    } catch {
      // ignore
    }
  }

  private buildSearchResponse(
    sessionId: string,
    session: { userId: string; results: any[]; query: string },
    page: number,
  ): { embeds: EmbedBuilder[]; components: any[]; files: AttachmentBuilder[] } {
    const totalPages = Math.max(
      1,
      Math.ceil(session.results.length / GAME_SEARCH_PAGE_SIZE),
    );
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * GAME_SEARCH_PAGE_SIZE;
    const displayedResults = session.results.slice(
      start,
      start + GAME_SEARCH_PAGE_SIZE,
    );
    const resultList = displayedResults.map((g) => `• **${g.title}**`).join("\n");

    const title = session.query
      ? `Search Results for "${session.query}" (Page ${safePage + 1}/${totalPages})`
      : `All Games (Page ${safePage + 1}/${totalPages})`;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(resultList || "No results.")
      .setFooter({
        text: `${session.results.length} results total`,
      });
    applyGameDbThumbnail(embed);

    const selectCustomId = `gamedb-search-select:${sessionId}:${session.userId}:${safePage}`;
    const options = displayedResults.map((g) => ({
      label: g.title.substring(0, 100),
      value: String(g.id),
      description: "View this game",
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(selectCustomId)
      .setPlaceholder("Select a game to view details")
      .addOptions(options);

    const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    const prevDisabled = safePage === 0;
    const nextDisabled = safePage >= totalPages - 1;

    const prevButton = new ButtonBuilder()
      .setCustomId(`gamedb-search-page:${sessionId}:${session.userId}:${safePage}:prev`)
      .setLabel("Previous Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);

    const nextButton = new ButtonBuilder()
      .setCustomId(`gamedb-search-page:${sessionId}:${session.userId}:${safePage}:next`)
      .setLabel("Next Page")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
    const components: ActionRowBuilder<any>[] = [selectRow];

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttonRow);
    }

    return {
      embeds: [embed],
      components,
      files: [buildGameDbThumbAttachment()],
    };
  }
}
