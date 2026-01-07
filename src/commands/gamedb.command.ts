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
  ComponentType,
  type ForumChannel,
  type Message,
  type TextBasedChannel,
  type MessageCreateOptions,
  type ActionRow,
  type MessageActionRowComponent,
  AttachmentBuilder,
  escapeCodeBlock,
  MessageFlags,
} from "discord.js";
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
import { getThreadsByGameId, setThreadGameLink, upsertThreadRecord } from "../classes/Thread.js";
import axios from "axios"; // For downloading image attachments
import { igdbService, type IGDBGame } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import Member from "../classes/Member.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "./profile.command.js";

const GAME_SEARCH_PAGE_SIZE = 25;
const NOW_PLAYING_FORUM_ID = "1059875931356938240";
const NOW_PLAYING_SIDEGAME_TAG_ID = "1059912719366635611";
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

const MAX_COMPLETION_NOTE_LEN = 500;
const MAX_NOW_PLAYING_NOTE_LEN = 500;

type PromptChoiceOption = {
  label: string;
  value: string;
  style?: ButtonStyle;
};

function buildChoiceRows(
  customIdPrefix: string,
  options: PromptChoiceOption[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < options.length; i += 5) {
    const slice = options.slice(i, i + 5);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      slice.map((opt) =>
        new ButtonBuilder()
          .setCustomId(`${customIdPrefix}:${opt.value}`)
          .setLabel(opt.label)
          .setStyle(opt.style ?? ButtonStyle.Secondary),
      ),
    );
    rows.push(row);
  }
  return rows;
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

      const opts: IgdbSelectOption[] = await this.buildIgdbSelectOptions(results);

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
      const opts: IgdbSelectOption[] = await this.buildIgdbSelectOptions(results);

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

  private async buildIgdbSelectOptions(
    results: IGDBGame[],
  ): Promise<IgdbSelectOption[]> {
    const platformIds: number[] = [];
    for (const game of results) {
      const ids = (game.platforms ?? [])
        .map((platform) => platform.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      platformIds.push(...ids);
    }

    const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
    const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
    const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
    if (missingPlatformIds.length) {
      console.warn(
        `[GameDB] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
      );
    }

    return results.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      const ids = (game.platforms ?? [])
        .map((platform) => platform.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      const platformNames = ids
        .map((id) => platformMap.get(id)?.name)
        .filter((name): name is string => Boolean(name));
      const platformLabel = platformNames.length
        ? `Platforms: ${platformNames.join(", ")}`
        : "Platforms: Unknown";
      const summary = game.summary || "No summary";
      const description = `${platformLabel} — ${summary}`.substring(0, 95);

      return {
        id: game.id,
        label: `${game.name} (${year})`,
        description,
      };
    });
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

    // 6aa. Save platform relationships
    const igdbPlatformIds: number[] = (details.platforms ?? [])
      .map((platform) => platform.id)
      .filter((id) => Number.isInteger(id) && id > 0);
    await Game.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);

    // 6b. Process Releases
    await this.processReleaseDates(
      newGame.id,
      details.release_dates || [],
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
    const attachments: AttachmentBuilder[] = [];
    if (imageData) {
      embed.setImage("attachment://cover.jpg");
      attachments.push(new AttachmentBuilder(imageData, { name: "cover.jpg" }));
    }
    await safeReply(interaction, {
      content: `Successfully added **${newGame.title}** (ID: ${newGame.id}) to the database!`,
      embeds: [embed],
      files: attachments.length ? attachments : undefined,
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
      await this.runSearchFlow(interaction, "");
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

    const includeActions =
      !("isMessageComponent" in interaction) ||
      !interaction.isMessageComponent();
    const components = includeActions
      ? [this.buildGameProfileActionRow(gameId, profile.hasThread)]
      : [];

    await safeReply(interaction, {
      embeds: profile.embeds,
      files: profile.files,
      components: components.length ? components : undefined,
    });
  }

  private async buildGameProfile(
    gameId: number,
    interaction?: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  ): Promise<{
    embeds: EmbedBuilder[];
    files: AttachmentBuilder[];
    hasThread: boolean;
  } | null> {
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
      const alternateVersions = await Game.getAlternateVersions(gameId);
      const linkedThreads = await getThreadsByGameId(gameId);

      const platformMap = new Map(platforms.map((p) => [p.id, p.name]));
      const regionMap = new Map(regions.map((r) => [r.id, r.name]));

      const description = game.description || "No description available.";

      const embed = new EmbedBuilder()
        .setTitle(`${game.title} (GameDB #${game.id})`)
        .setColor(0x0099ff);

      if (game.igdbUrl) {
        embed.setURL(game.igdbUrl);
      }

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
        linkedThreads[0] ??
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

      if (alternateVersions.length) {
        const lines = alternateVersions.map(
          (alt) => `• **${alt.title}** (GameDB #${alt.id})`,
        );
        const value = this.buildListFieldValue(lines, 1024);
        embed.addFields({ name: "Alternate Versions", value, inline: false });
      }

      if (game.totalRating) {
        embed.addFields({
          name: "IGDB Rating",
          value: `${Math.round(game.totalRating)}/100`,
          inline: true,
        });
      }

      const files: AttachmentBuilder[] = [];
      if (game.imageData) {
        files.push(new AttachmentBuilder(game.imageData, { name: "game_image.png" }));
      }

      return { embeds: [embed], files, hasThread: Boolean(threadId) };
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

  private buildListFieldValue(lines: string[], maxLength: number): string {
    if (!lines.length) return "None";
    const output: string[] = [];
    let currentLength = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const nextLength = currentLength + line.length + 1;
      if (nextLength > maxLength) {
        const remaining = lines.length - i;
        output.push(`…and ${remaining} more`);
        break;
      }
      output.push(line);
      currentLength = nextLength;
    }

    return output.join("\n");
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

  private buildGameProfileActionRow(
    gameId: number,
    hasThread: boolean,
  ): ActionRowBuilder<ButtonBuilder> {
    const addNowPlaying = new ButtonBuilder()
      .setCustomId(`gamedb-action:nowplaying:${gameId}`)
      .setLabel("Add to Now Playing List")
      .setStyle(ButtonStyle.Primary);
    const addCompletion = new ButtonBuilder()
      .setCustomId(`gamedb-action:completion:${gameId}`)
      .setLabel("Add Completion")
      .setStyle(ButtonStyle.Success);

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      addNowPlaying,
      addCompletion,
    );
    if (!hasThread) {
      const addThread = new ButtonBuilder()
        .setCustomId(`gamedb-action:thread:${gameId}`)
        .setLabel("Add Now Playing Thread")
        .setStyle(ButtonStyle.Secondary);
      actionRow.addComponents(addThread);
    }
    return actionRow;
  }

  @ButtonComponent({ id: /^gamedb-action:(nowplaying|completion|thread):\d+$/ })
  async handleGameDbAction(interaction: ButtonInteraction): Promise<void> {
    const [, action, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.reply({
        content: "Invalid GameDB id.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.followUp({
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (action === "nowplaying" || action === "completion") {
      const parentMessage = interaction.message;
      if (!parentMessage || typeof parentMessage.startThread !== "function") {
        await interaction.followUp({
          content: "Unable to start a thread from this message.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      const threadName = action === "nowplaying"
        ? `${game.title} - Now Playing`
        : `${game.title} - Completion`;
      const thread = await parentMessage.startThread({
        name: threadName.slice(0, 100),
        autoArchiveDuration: 60,
      }).catch(() => null);
      if (!thread) {
        await interaction.followUp({
          content: "Failed to create a thread for the wizard.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      const baseEmbed = this.getWizardBaseEmbed(interaction, action === "nowplaying"
        ? "Now Playing Wizard"
        : "Completion Wizard");
      const wizardMessage = await thread.send({
        content: `<@${interaction.user.id}>`,
        embeds: [baseEmbed],
      });

      if (action === "nowplaying") {
        await this.runNowPlayingWizard(interaction, gameId, game.title, thread, wizardMessage);
        return;
      }

      await this.runCompletionWizard(interaction, gameId, game.title, thread, wizardMessage);
      return;
    }

    if (action === "thread") {
      await this.runNowPlayingThreadWizard(interaction, gameId, game.title);
      return;
    }
  }

  private async runNowPlayingWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
    thread?: TextBasedChannel,
    wizardMessage?: Message,
  ): Promise<void> {
    const baseEmbed = this.getWizardBaseEmbed(interaction, "Now Playing Wizard");
    let logHistory = "";
    let finalMessage: string | null = null;
    const updateEmbed = async (log?: string) => {
      if (log) {
        logHistory += `${log}\n`;
      }
      if (logHistory.length > 3500) {
        logHistory = "..." + logHistory.slice(logHistory.length - 3500);
      }
      const embed = this.buildWizardEmbed(baseEmbed, logHistory || "Processing...");
      if (wizardMessage) {
        await wizardMessage.edit({ embeds: [embed] }).catch(() => {});
      } else {
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      }
    };

    const wizardPrompt = async (question: string): Promise<string | null> => {
      await updateEmbed(`\n❓ **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.awaitMessages !== "function") {
        await updateEmbed("❌ Cannot prompt for input in this channel.");
        return null;
      }
      const collected = await channel.awaitMessages({
        filter: (m: Message) => m.author.id === interaction.user.id,
        max: 1,
        time: 120_000,
      }).catch(() => null);
      const first = collected?.first();
      if (!first) {
        await updateEmbed("❌ Timed out.");
        return null;
      }
      const content = first.content.trim();
      await first.delete().catch(() => {});
      await updateEmbed(`> *${content}*`);
      if (/^cancel$/i.test(content)) {
        await updateEmbed("❌ Cancelled by user.");
        return null;
      }
      return content;
    };

    const wizardChoice = async (
      question: string,
      options: PromptChoiceOption[],
    ): Promise<string | null> => {
      await updateEmbed(`\n❓ **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.send !== "function") {
        await updateEmbed("❌ Cannot prompt for input in this channel.");
        return null;
      }

      const promptId = `gamedb-choice:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const rows = buildChoiceRows(promptId, options);
      const promptMessage: Message | null = await channel.send({
        content: `<@${interaction.user.id}> ${question}`,
        components: rows,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => null);
      if (!promptMessage) {
        await updateEmbed("❌ Failed to send prompt.");
        return null;
      }

      try {
        const selection = await promptMessage.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) =>
            i.user.id === interaction.user.id && i.customId.startsWith(`${promptId}:`),
          time: 120_000,
        });
        await selection.deferUpdate().catch(() => {});
        const value = selection.customId.slice(promptId.length + 1);
        const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed(`> *${chosenLabel}*`);
        if (value === "cancel") {
          await updateEmbed("❌ Cancelled by user.");
          return null;
        }
        return value;
      } catch {
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed("❌ Timed out waiting for a selection.");
        return null;
      }
    };

    await updateEmbed(`✅ Starting for **${gameTitle}**`);

    let note: string | null = null;
    const noteChoice = await wizardChoice(
      "Add a note?",
      [
        { label: "Enter Note", value: "enter", style: ButtonStyle.Primary },
        { label: "Skip", value: "skip" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (noteChoice === null) return;
    if (noteChoice === "enter") {
      while (true) {
        const response = await wizardPrompt("Enter a note for this Now Playing entry.");
        if (response === null) return;
        if (response.length > MAX_NOW_PLAYING_NOTE_LEN) {
          await updateEmbed(`Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`);
          continue;
        }
        note = response;
        break;
      }
    }

    try {
      await Member.addNowPlaying(interaction.user.id, gameId, note);
      await updateEmbed(`✅ Added **${gameTitle}** to your Now Playing list.`);
      finalMessage = `✅ Added **${gameTitle}** to your Now Playing list.`;
    } catch (err: any) {
      const msg = `❌ Failed to add: ${err?.message ?? String(err)}`;
      await updateEmbed(msg);
      finalMessage = msg;
    } finally {
      if (finalMessage) {
        await interaction.followUp({
          content: finalMessage,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      if (thread && "delete" in thread) {
        await thread.delete().catch(() => {});
      }
    }
  }

  private async runNowPlayingThreadWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
  ): Promise<void> {
    const existingThreads = await getThreadsByGameId(gameId);
    if (existingThreads.length) {
      await interaction.followUp({
        content: "A thread is already linked to this game.",
      });
      return;
    }

    const forum = (await interaction.guild?.channels.fetch(
      NOW_PLAYING_FORUM_ID,
    )) as ForumChannel | null;
    if (!forum) {
      await interaction.followUp({
        content: "Now Playing forum channel was not found.",
      });
      return;
    }

    const threadTitle = gameTitle;

    const memberDisplayName =
      (interaction.member as any)?.displayName ?? interaction.user.username ?? "User";
    const game = await Game.getGameById(gameId);
    const files = game?.imageData
      ? [new AttachmentBuilder(game.imageData, { name: `gamedb_${gameId}.png` })]
      : [];
    const messagePayload: MessageCreateOptions = {
      content: `Now Playing thread created by ${memberDisplayName}.`,
      allowedMentions: { parse: [] as const },
    };
    if (files.length) {
      messagePayload.files = files;
    }

    try {
      const thread = await forum.threads.create({
        name: threadTitle,
        message: messagePayload,
        appliedTags: [NOW_PLAYING_SIDEGAME_TAG_ID],
      });
      await upsertThreadRecord({
        threadId: thread.id,
        forumChannelId: thread.parentId ?? NOW_PLAYING_FORUM_ID,
        threadName: thread.name ?? threadTitle,
        isArchived: Boolean(thread.archived),
        createdAt: thread.createdAt ?? new Date(),
        lastSeenAt: null,
        skipLinking: "Y",
      });
      await setThreadGameLink(thread.id, gameId);
      await interaction.followUp({
        content: `Created and linked <#${thread.id}>.`,
      });
      const nowPlayingMembers = await Game.getNowPlayingMembers(gameId);
      const completions = await Game.getGameCompletions(gameId);
      const mentionIds = new Set<string>([interaction.user.id]);
      nowPlayingMembers.forEach((member) => mentionIds.add(member.userId));
      completions.forEach((member) => mentionIds.add(member.userId));

      if (mentionIds.size) {
        const mentions = Array.from(mentionIds).map((id) => `<@${id}>`);
        const lines: string[] = [];
        let buffer = "";
        for (const mention of mentions) {
          const next = buffer ? `${buffer} ${mention}` : mention;
          if (next.length > 1900) {
            lines.push(buffer);
            buffer = mention;
          } else {
            buffer = next;
          }
        }
        if (buffer) lines.push(buffer);

        for (const line of lines) {
          await thread.send({ content: line });
        }
      }

      const profile = await this.buildGameProfile(gameId, interaction);
      if (profile) {
        const actionRow = this.buildGameProfileActionRow(gameId, profile.hasThread);
        const existingComponents = interaction.message?.components ?? [];
        const updatedComponents = existingComponents.length
          ? existingComponents.map((row) => {
              if (!("components" in row)) return row;
              const actionRowComponents = (row as ActionRow<MessageActionRowComponent>).components;
              const hasGameDbAction = actionRowComponents.some((component) =>
                component.customId?.startsWith("gamedb-action:"),
              );
              return hasGameDbAction ? actionRow : row;
            })
          : [actionRow];
        await interaction.editReply({
          embeds: profile.embeds,
          files: profile.files,
          components: updatedComponents,
        }).catch(() => {});
      }
    } catch (err: any) {
      await interaction.followUp({
        content: `Failed to create thread: ${err?.message ?? String(err)}`,
      });
    }
  }

  private async runCompletionWizard(
    interaction: ButtonInteraction,
    gameId: number,
    gameTitle: string,
    thread?: TextBasedChannel,
    wizardMessage?: Message,
  ): Promise<void> {
    const baseEmbed = this.getWizardBaseEmbed(interaction, "Completion Wizard");
    let logHistory = "";
    let finalMessage: string | null = null;
    const updateEmbed = async (log?: string) => {
      if (log) {
        logHistory += `${log}\n`;
      }
      if (logHistory.length > 3500) {
        logHistory = "..." + logHistory.slice(logHistory.length - 3500);
      }
      const embed = this.buildWizardEmbed(baseEmbed, logHistory || "Processing...");
      if (wizardMessage) {
        await wizardMessage.edit({ embeds: [embed] }).catch(() => {});
      } else {
        await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
      }
    };

    const wizardPrompt = async (question: string): Promise<string | null> => {
      await updateEmbed(`\n❓ **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.awaitMessages !== "function") {
        await updateEmbed("❌ Cannot prompt for input in this channel.");
        return null;
      }
      const collected = await channel.awaitMessages({
        filter: (m: Message) => m.author.id === interaction.user.id,
        max: 1,
        time: 120_000,
      }).catch(() => null);
      const first = collected?.first();
      if (!first) {
        await updateEmbed("❌ Timed out.");
        return null;
      }
      const content = first.content.trim();
      await first.delete().catch(() => {});
      await updateEmbed(`> *${content}*`);
      if (/^cancel$/i.test(content)) {
        await updateEmbed("❌ Cancelled by user.");
        return null;
      }
      return content;
    };

    const wizardChoice = async (
      question: string,
      options: PromptChoiceOption[],
    ): Promise<string | null> => {
      await updateEmbed(`Prompt: **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.send !== "function") {
        await updateEmbed("Cannot prompt for input in this channel.");
        return null;
      }

      const promptId = `gamedb-choice:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const rows = buildChoiceRows(promptId, options);
      const promptMessage: Message | null = await channel.send({
        content: `<@${interaction.user.id}> ${question}`,
        components: rows,
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => null);
      if (!promptMessage) {
        await updateEmbed("Failed to send prompt.");
        return null;
      }

      try {
        const selection = await promptMessage.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) =>
            i.user.id === interaction.user.id && i.customId.startsWith(`${promptId}:`),
          time: 120_000,
        });
        await selection.deferUpdate().catch(() => {});
        const value = selection.customId.slice(promptId.length + 1);
        const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed(`Selected: *${chosenLabel}*`);
        if (value === "cancel") {
          await updateEmbed("Cancelled by user.");
          return null;
        }
        return value;
      } catch {
        await promptMessage.edit({ components: [] }).catch(() => {});
        await updateEmbed("Timed out waiting for a selection.");
        return null;
      }
    };
    await updateEmbed(`✅ Starting for **${gameTitle}**`);

    let completionType: CompletionType | null = null;
    const completionChoice = await wizardChoice(
      "Completion type?",
      [
        ...COMPLETION_TYPES.map((value) => ({
          label: value.slice(0, 80),
          value,
          style: ButtonStyle.Primary,
        })),
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (completionChoice === null) return;
    completionType = completionChoice as CompletionType;

    let completedAt: Date | null = null;
    const dateChoice = await wizardChoice(
      "Completion date?",
      [
        { label: "Today", value: "today", style: ButtonStyle.Primary },
        { label: "Unknown", value: "unknown" },
        { label: "Enter Date", value: "date" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (dateChoice === null) return;
    if (dateChoice === "today") {
      completedAt = new Date();
    } else if (dateChoice === "unknown") {
      completedAt = null;
    } else {
      while (true) {
        const response = await wizardPrompt("Enter completion date (YYYY-MM-DD).")
        if (response === null) return;
        try {
          completedAt = parseCompletionDateInput(response);
          break;
        } catch (err: any) {
          await updateEmbed(`Error: ${err?.message ?? "Invalid date."}`);
        }
      }
    }

    let playtime: number | null = null;
    const playtimeChoice = await wizardChoice(
      "Final playtime in hours?",
      [
        { label: "Enter Hours", value: "enter", style: ButtonStyle.Primary },
        { label: "Skip", value: "skip" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (playtimeChoice === null) return;
    if (playtimeChoice === "enter") {
      while (true) {
        const response = await wizardPrompt("Enter the playtime in hours (e.g., 42.5).")
        if (response === null) return;
        const num = Number(response);
        if (Number.isNaN(num) || num < 0) {
          await updateEmbed("Playtime must be a non-negative number.");
          continue;
        }
        playtime = num;
        break;
      }
    }

    let note: string | null = null;
    const noteChoice = await wizardChoice(
      "Add a note?",
      [
        { label: "Enter Note", value: "enter", style: ButtonStyle.Primary },
        { label: "Skip", value: "skip" },
        { label: "Cancel", value: "cancel", style: ButtonStyle.Danger },
      ],
    );
    if (noteChoice === null) return;
    if (noteChoice === "enter") {
      while (true) {
        const response = await wizardPrompt("Enter a completion note.");
        if (response === null) return;
        if (response.length > MAX_COMPLETION_NOTE_LEN) {
          await updateEmbed(`Note must be ${MAX_COMPLETION_NOTE_LEN} characters or fewer.`);
          continue;
        }
        note = response;
        break;
      }
    }

    try {
      await Member.addCompletion({
        userId: interaction.user.id,
        gameId,
        completionType: completionType ?? "Main Story",
        completedAt,
        finalPlaytimeHours: playtime,
        note,
      });
      await Member.removeNowPlaying(interaction.user.id, gameId).catch(() => {});
      await updateEmbed(`✅ Added completion for **${gameTitle}**.`);
      finalMessage = `✅ Added completion for **${gameTitle}**.`;
    } catch (err: any) {
      const msg = `❌ Failed to add completion: ${err?.message ?? String(err)}`;
      await updateEmbed(msg);
      finalMessage = msg;
    } finally {
      if (finalMessage) {
        await interaction.followUp({
          content: finalMessage,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      if (thread && "delete" in thread) {
        await thread.delete().catch(() => {});
      }
    }
  }

  private getWizardBaseEmbed(
    interaction: ButtonInteraction,
    fallbackTitle: string,
  ): EmbedBuilder {
    return new EmbedBuilder().setTitle(fallbackTitle).setColor(0x0099ff);
  }

  private buildWizardEmbed(base: EmbedBuilder, log: string): EmbedBuilder {
    const embed = EmbedBuilder.from(base);
    const baseDesc = base.data.description ?? "";
    const divider = baseDesc ? "\n\n" : "";
    const combined = `${baseDesc}${divider}${log}`.trim();
    embed.setDescription(combined.slice(0, 4096));
    return embed;
  }

  // Helper to process release dates
  private async processReleaseDates(
    gameId: number,
    releaseDates: any[],
  ): Promise<void> {
    if (!releaseDates || !Array.isArray(releaseDates)) {
      return;
    }

    const platformIds: number[] = [];
    for (const release of releaseDates) {
      const platformId: number | null = typeof release.platform === "number"
        ? release.platform
        : (release.platform?.id ?? null);
      if (platformId) {
        platformIds.push(platformId);
      }
    }
    const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
    const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
    const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
    if (missingPlatformIds.length) {
      console.warn(
        `[GameDB] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
      );
    }

    for (const release of releaseDates) {
      const platformId: number | null = typeof release.platform === "number"
        ? release.platform
        : (release.platform?.id ?? null);
      if (!platformId || !release.region) {
        continue;
      }

      const platform = platformMap.get(platformId);
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
    const actionRow = this.buildGameProfileActionRow(gameId, profile.hasThread);

    try {
      await interaction.editReply({
        embeds: profile.embeds,
        files: profile.files,
        components: [actionRow, ...response.components],
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
  ): { embeds: EmbedBuilder[]; components: any[] } {
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
    };
  }
}
