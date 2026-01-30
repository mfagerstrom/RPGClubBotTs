import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  AutocompleteInteraction,
  ActionRowBuilder,
  StringSelectMenuInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  type ForumChannel,
  type Message,
  type ThreadChannel,
  type TextBasedChannel,
  type MessageCreateOptions,
  type ActionRow,
  type MessageActionRowComponent,
  AttachmentBuilder,
  MessageFlags,
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
import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "@discordjs/builders";
import {
  safeDeferReply,
  safeReply,
  sanitizeUserInput,
  stripModalInput,
} from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Game from "../classes/Game.js";
import { getHltbCacheByGameId, upsertHltbCache } from "../classes/HltbCache.js";
import { getThreadsByGameId, setThreadGameLink, upsertThreadRecord } from "../classes/Thread.js";
import axios from "axios"; // For downloading image attachments
import { igdbService, type IGDBGame } from "../services/IgdbService.js";
import {
  createIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import Member from "../classes/Member.js";
import { NowPlayingCommand } from "./now-playing.command.js";
import {
  COMPLETION_TYPES,
  type CompletionType,
  parseCompletionDateInput,
} from "./profile.command.js";
import { notifyUnknownCompletionPlatform } from "../functions/CompletionHelpers.js";
import { searchHltb } from "../scripts/SearchHltb.js";
import { formatPlatformDisplayName } from "../functions/PlatformDisplay.js";
import { NOW_PLAYING_FORUM_ID } from "../config/channels.js";

const GAME_SEARCH_PAGE_SIZE = 25;
const NOW_PLAYING_SIDEGAME_TAG_ID = "1059912719366635611";
const COMPONENTS_V2_FLAG = 1 << 15;
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

function buildComponentsV2Flags(isEphemeral: boolean): number {
  return (isEphemeral ? MessageFlags.Ephemeral : 0) | COMPONENTS_V2_FLAG;
}

function getReleaseYear(game: { initialReleaseDate?: Date | null }): number | null {
  const releaseDate = game.initialReleaseDate;
  if (!releaseDate) return null;
  const date = releaseDate instanceof Date ? releaseDate : new Date(releaseDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

function formatTitleWithYear(
  game: { title: string; initialReleaseDate?: Date | null },
  isDuplicate: boolean,
): string {
  if (!isDuplicate) {
    return game.title;
  }
  const year = getReleaseYear(game);
  const yearText = year ? ` (${year})` : " (Unknown Year)";
  return `${game.title}${yearText}`;
}

function isHltbImportEligible(
  game: { initialReleaseDate?: Date | null },
  hasCache: boolean,
): boolean {
  if (hasCache) return false;
  if (!game.initialReleaseDate) return false;
  const releaseDate = game.initialReleaseDate instanceof Date
    ? game.initialReleaseDate
    : new Date(game.initialReleaseDate);
  if (Number.isNaN(releaseDate.getTime())) return false;
  const now = new Date();
  if (releaseDate > now) return false;
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return releaseDate <= sixMonthsAgo;
}

function getSearchRowsFromComponents(
  components: Array<ActionRow<MessageActionRowComponent> | unknown>,
): ActionRow<MessageActionRowComponent>[] {
  return components.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const rowComponents = "components" in row ? (row as any).components : [];
    return Array.isArray(rowComponents) && rowComponents.some((component) =>
      component.customId?.startsWith("gamedb-search-"),
    );
  }) as ActionRow<MessageActionRowComponent>[];
}

async function autocompleteGameDbViewTitle(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  const rawQuery = focused?.value ? String(focused.value) : "";
  const query = sanitizeUserInput(rawQuery, { preserveNewlines: false }).trim();
  if (!query) {
    await interaction.respond([]);
    return;
  }
  const results = await Game.searchGames(query);
  const titleCounts = new Map<string, number>();
  results.forEach((game) => {
    const title = String(game.title ?? "");
    titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  });
  const options = results.slice(0, 25).map((game) => {
    const title = String(game.title ?? "");
    const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
    const label = formatTitleWithYear(game, isDuplicate);
    return {
      name: label.slice(0, 100),
      value: String(game.id),
    };
  });
  await interaction.respond(options);
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
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (igdbId) {
      await this.addGameToDatabase(interaction, Number(igdbId), { selectionMessage: null });
      return;
    }

    const sanitizedTitle = title
      ? sanitizeUserInput(title, { preserveNewlines: false })
      : "";
    const sanitizedBulk = bulkTitles
      ? sanitizeUserInput(bulkTitles, { preserveNewlines: false })
      : "";
    const parsedBulk = sanitizedBulk
      ? sanitizedBulk.split(",").map((t) => t.trim()).filter(Boolean)
      : [];
    const singleTitle = sanitizedTitle.trim();
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
      await this.processTitle(interaction, t);
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
        await this.addGameToDatabase(interaction, results[0].id, {
          selectionMessage: null,
          showProfile: true,
        });
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

      const baseText =
        `## IGDB Results for "${query}"\n` +
        `Found ${totalLabel} results. Showing first ${Math.min(results.length, 22)}.` +
        `${pagingHint ? ` ${pagingHint}` : ""}`;
      const contentParts = [baseText];
      if (existingText) {
        contentParts.push(`**Existing GameDB matches**\n${existingText}`);
      }
      const content = this.trimTextDisplayContent(contentParts.join("\n\n"));
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );

      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
        __forceFollowUp: true,
      });
    } catch (err: any) {
      await safeReply(interaction, {
        content: `Auto-import failed: ${err?.message ?? err}`,
        __forceFollowUp: true,
      });
    }
  }
  private async processTitle(
    interaction: CommandInteraction,
    title: string,
  ): Promise<void> {
    try {
      // 1. Search IGDB
      const searchRes = await igdbService.searchGames(title);
      const results = searchRes.results;

      if (!results || results.length === 0) {
        await this.handleNoResults(interaction, title);
        return;
      }

      // 1b. Single Result - Auto Add
      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id, {
          selectionMessage: null,
          showProfile: true,
        });
        return;
      }

      // 2. Build Select Menu
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

      const content = this.trimTextDisplayContent(
        `## IGDB Results for "${title}"\nFound ${results.length} results. Please select one:`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );
      await safeReply(interaction, {
        components: [container, ...components],
        flags: buildComponentsV2Flags(false),
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
        .map((id) => formatPlatformDisplayName(platformMap.get(id)?.name))
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
    opts?: { selectionMessage?: Message | null; showProfile?: boolean },
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
      Game.getFeaturedVideoUrl(details),
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

    if (opts?.showProfile) {
      await this.showGameProfile(interaction, newGame.id, true);
      return;
    }

    // 7. Show the /gamedb view for the newly added game
    await this.showGameProfile(interaction, newGame.id, true);
  }

  @Slash({ description: "View details of a game", name: "view" })
  async view(
    @SlashOption({
      description: "Search query (falls back to search flow if no ID provided)",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
      autocomplete: autocompleteGameDbViewTitle,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
    if (/^\d+$/.test(searchTerm)) {
      const gameId = Number(searchTerm);
      if (Number.isInteger(gameId) && gameId > 0) {
        const game = await Game.getGameById(gameId);
        if (game) {
          await this.showGameProfile(interaction, gameId);
          return;
        }
      }
    }
    await this.runSearchFlow(interaction, searchTerm);
  }

  private async showGameProfile(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    gameId: number,
    includeActionsOverride?: boolean,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) {
      await safeReply(interaction, {
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const includeActions = includeActionsOverride ?? (
      !("isMessageComponent" in interaction) ||
      !interaction.isMessageComponent()
    );
    const components = [...profile.components];
    if (includeActions) {
      components.push(
        this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canImportHltb,
        ),
      );
    }

    await safeReply(interaction, {
      embeds: [],
      files: profile.files,
      components,
      flags: buildComponentsV2Flags(false),
    });
  }

  public async showGameProfileFromNomination(
    interaction: StringSelectMenuInteraction,
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
    const components = [
      ...profile.components,
      this.buildGameProfileActionRow(
        gameId,
        profile.hasThread,
        profile.featuredVideoUrl,
        profile.canImportHltb,
      ),
    ];
    await safeReply(interaction, {
      embeds: [],
      files: profile.files,
      components,
      flags: buildComponentsV2Flags(true),
    });
  }

  private async buildGameProfile(
    gameId: number,
    interaction?: CommandInteraction | StringSelectMenuInteraction | ButtonInteraction,
  ): Promise<{
    components: Array<ContainerBuilder | ActionRowBuilder<ButtonBuilder>>;
    files: AttachmentBuilder[];
    hasThread: boolean;
    featuredVideoUrl: string | null;
    canImportHltb: boolean;
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
      const container = new ContainerBuilder();

      const files: AttachmentBuilder[] = [];
      if (game.imageData) {
        files.push(new AttachmentBuilder(game.imageData, { name: "game_image.png" }));
      }

      const rpgClubSections: string[] = [];
      const pushRpgClubSection = (title: string, value: string | null): void => {
        if (!value) return;
        rpgClubSections.push(`**${title}**\n${value}`);
      };

      const gotmNomineesByRound = new Map<number, string[]>();
      associations.gotmNominations.forEach((nom) => {
        const list = gotmNomineesByRound.get(nom.round) ?? [];
        list.push(nom.username);
        gotmNomineesByRound.set(nom.round, list);
      });
      const nrGotmNomineesByRound = new Map<number, string[]>();
      associations.nrGotmNominations.forEach((nom) => {
        const list = nrGotmNomineesByRound.get(nom.round) ?? [];
        list.push(nom.username);
        nrGotmNomineesByRound.set(nom.round, list);
      });

      if (associations.gotmWins.length) {
        const lines = associations.gotmWins.map((win) => {
          const nominees = gotmNomineesByRound.get(win.round) ?? [];
          if (!nominees.length) {
            return `Round ${win.round}`;
          }
          return `Round ${win.round} (nominated by ${nominees.join(", ")})`;
        });
        pushRpgClubSection("GOTM Round(s)", lines.join("\n"));
      }

      if (associations.nrGotmWins.length) {
        const lines = associations.nrGotmWins.map((win) => {
          const nominees = nrGotmNomineesByRound.get(win.round) ?? [];
          if (!nominees.length) {
            return `Round ${win.round}`;
          }
          return `Round ${win.round} (nominated by ${nominees.join(", ")})`;
        });
        pushRpgClubSection("NR-GOTM Round(s)", lines.join("\n"));
      }

      // Thread / Reddit links as their own sections
      const threadId =
        associations.gotmWins.find((w) => w.threadId)?.threadId ??
        associations.nrGotmWins.find((w) => w.threadId)?.threadId ??
        nowPlayingMembers.find((p) => p.threadId)?.threadId ??
        linkedThreads[0] ??
        null;
      const headerLink = threadId
        ? `https://discord.com/channels/${interaction?.guildId ?? "@me"}/${threadId}`
        : null;
      const headerLines = [
        `## ${headerLink ? `[${game.title}](${headerLink})` : game.title}`,
      ];

      const redditUrlRaw =
        associations.gotmWins.find((w) => w.redditUrl)?.redditUrl ??
        associations.nrGotmWins.find((w) => w.redditUrl)?.redditUrl ??
        null;
      const redditUrl = redditUrlRaw === "__NO_VALUE__" ? null : redditUrlRaw;
      if (redditUrl) {
        pushRpgClubSection("Reddit Discussion Thread", `[Reddit Link](${redditUrl})`);
      }

      if (nowPlayingMembers.length) {
        const MAX_NOW_PLAYING_DISPLAY = 12;
        const lines = nowPlayingMembers.slice(0, MAX_NOW_PLAYING_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return name;
        });

        if (nowPlayingMembers.length > MAX_NOW_PLAYING_DISPLAY) {
          const remaining = nowPlayingMembers.length - MAX_NOW_PLAYING_DISPLAY;
          lines.push(`…and ${remaining} more playing now.`);
        }

        pushRpgClubSection("Now Playing", lines.join(", "));
      }

      if (completions.length) {
        const MAX_COMPLETIONS_DISPLAY = 12;
        const uniqueCompletions = new Map<string, (typeof completions)[number]>();
        completions.forEach((member) => {
          if (!uniqueCompletions.has(member.userId)) {
            uniqueCompletions.set(member.userId, member);
          }
        });
        const uniqueList = Array.from(uniqueCompletions.values());
        const lines = uniqueList.slice(0, MAX_COMPLETIONS_DISPLAY).map((member) => {
          const name = member.globalName ?? member.username ?? member.userId;
          return name;
        });

        if (uniqueList.length > MAX_COMPLETIONS_DISPLAY) {
          const remaining = uniqueList.length - MAX_COMPLETIONS_DISPLAY;
          lines.push(`…and ${remaining} more completed this.`);
        }

        pushRpgClubSection("Completed By", lines.join(", "));
      }

      const gotmWinRounds = new Set(associations.gotmWins.map((win) => win.round));
      const nrGotmWinRounds = new Set(associations.nrGotmWins.map((win) => win.round));

      const gotmNominations = associations.gotmNominations.filter(
        (nom) => !gotmWinRounds.has(nom.round),
      );
      if (gotmNominations.length) {
        const lines = gotmNominations.map(
          (nom) => `Round ${nom.round} - ${nom.username}`,
        );
        pushRpgClubSection("GOTM Nominations", lines.join(", "));
      }

      const nrGotmNominations = associations.nrGotmNominations.filter(
        (nom) => !nrGotmWinRounds.has(nom.round),
      );
      if (nrGotmNominations.length) {
        const lines = nrGotmNominations.map(
          (nom) => `Round ${nom.round} - ${nom.username}`,
        );
        pushRpgClubSection("NR-GOTM Nominations", lines.join(", "));
      }

      const bodyParts: string[] = [];
      bodyParts.push(`**Description**\n${description}`);
      const initialReleaseDate = game.initialReleaseDate
        ? game.initialReleaseDate.toLocaleDateString()
        : "Unknown";
      bodyParts.push(`**Initial Release Date**\n${initialReleaseDate}`);

      if (releases.length > 0) {
        const releaseField = releases
          .map((r) => {
            const platformName = formatPlatformDisplayName(platformMap.get(r.platformId))
              ?? "Unknown Platform";
            const regionName = regionMap.get(r.regionId) || "Unknown Region";
            const regionSuffix = regionName === "Worldwide" ? "" : ` (${regionName})`;
            const releaseDate = r.releaseDate ? r.releaseDate.toLocaleDateString() : "TBD";
            const format = r.format ? `(${r.format})` : "";
            return `• **${platformName}**${regionSuffix} ${format} - ${releaseDate}`;
          })
          .join("\n");
        bodyParts.push(`**Releases**\n${releaseField}`);
      }

      const hltbCache = await getHltbCacheByGameId(gameId);
      const canImportHltb = isHltbImportEligible(game, Boolean(hltbCache));
      if (hltbCache) {
        const hltbLines: string[] = [];
        if (hltbCache.main) hltbLines.push(`**Main:** ${hltbCache.main}`);
        if (hltbCache.mainSides) hltbLines.push(`**Main + Sides:** ${hltbCache.mainSides}`);
        if (hltbCache.completionist) hltbLines.push(`**Completionist:** ${hltbCache.completionist}`);
        if (hltbCache.singlePlayer) hltbLines.push(`**Single-Player:** ${hltbCache.singlePlayer}`);
        if (hltbCache.coOp) hltbLines.push(`**Co-Op:** ${hltbCache.coOp}`);
        if (hltbCache.vs) hltbLines.push(`**Vs.:** ${hltbCache.vs}`);
        if (hltbLines.length) {
          bodyParts.push(`**HowLongToBeat™**\n${hltbLines.join("\n")}`);
        }
      }

      const series = await Game.getGameSeries(gameId);
      const detailSections: string[] = [];

      if (series) {
        detailSections.push(`**Series / Collection**\n${series}`);
      }

      if (alternateVersions.length) {
        const lines = alternateVersions.map(
          (alt) => `• **${alt.title}** (GameDB #${alt.id})`,
        );
        const value = this.buildListFieldValue(lines, 2000);
        detailSections.push(`**Alternate Versions**\n${value}`);
      }

      if (detailSections.length) {
        bodyParts.push(detailSections.join("\n\n"));
      }

      if (rpgClubSections.length) {
        bodyParts.push(rpgClubSections.join("\n\n"));
      }

      const igdbIdText = game.igdbId ? String(game.igdbId) : "N/A";
      bodyParts.push(`-# GameDB ID: ${game.id} | IGDB ID: ${igdbIdText}`);

      const content = this.trimTextDisplayContent(
        [headerLines.join("\n"), bodyParts.join("\n\n")].filter(Boolean).join("\n"),
      );
      if (game.imageData) {
        const headerSection = new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
          .setThumbnailAccessory(
            new ThumbnailBuilder().setURL("attachment://game_image.png"),
          );
        container.addSectionComponents(headerSection);
      } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
      }

      return {
        components: [container],
        files,
        hasThread: Boolean(threadId),
        featuredVideoUrl: game.featuredVideoUrl ?? null,
        canImportHltb,
      };
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

  private trimTextDisplayContent(content: string): string {
    if (content.length <= 4000) {
      return content;
    }
    return `${content.slice(0, 3997)}...`;
  }

  private buildGameProfileActionRow(
    gameId: number,
    hasThread: boolean,
    featuredVideoUrl: string | null,
    canImportHltb: boolean,
  ): ActionRowBuilder<ButtonBuilder> {
    const addNowPlaying = new ButtonBuilder()
      .setCustomId(`gamedb-action:nowplaying:${gameId}`)
      .setLabel("Add to Now Playing List")
      .setStyle(ButtonStyle.Primary);
    const addCompletion = new ButtonBuilder()
      .setCustomId(`gamedb-action:completion:${gameId}`)
      .setLabel("Add Completion")
      .setStyle(ButtonStyle.Success);
    const viewFeaturedVideo = new ButtonBuilder()
      .setCustomId(`gamedb-action:video:${gameId}`)
      .setLabel("View Featured Video")
      .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      addNowPlaying,
      addCompletion,
    );
    if (featuredVideoUrl) {
      actionRow.addComponents(viewFeaturedVideo);
    }
    if (!hasThread) {
      const addThread = new ButtonBuilder()
        .setCustomId(`gamedb-action:thread:${gameId}`)
        .setLabel("Add Now Playing Thread")
        .setStyle(ButtonStyle.Secondary);
      actionRow.addComponents(addThread);
    }
    if (canImportHltb) {
      const importHltb = new ButtonBuilder()
        .setCustomId(`gamedb-action:hltb-import:${gameId}`)
        .setLabel("Import HLTB Data")
        .setStyle(ButtonStyle.Secondary);
      actionRow.addComponents(importHltb);
    }
    return actionRow;
  }

  private async refreshGameProfileMessage(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<void> {
    const profile = await this.buildGameProfile(gameId, interaction);
    if (!profile) return;
    const actionRow = this.buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canImportHltb,
    );
    const existingComponents = interaction.message?.components ?? [];
    const searchRows = getSearchRowsFromComponents(existingComponents);
    await interaction.editReply({
      embeds: [],
      files: profile.files,
      components: [...profile.components, actionRow, ...searchRows],
      flags: buildComponentsV2Flags(false),
    }).catch(() => {});
  }

  @ButtonComponent({ id: /^gamedb-action:(nowplaying|completion|thread|video|hltb-import):\d+$/ })
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

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.followUp({
        content: `No game found with ID ${gameId}.`,
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
      return;
    }

    if (action === "video") {
      const videoUrl = game.featuredVideoUrl;
      if (!videoUrl) {
        await safeReply(interaction, {
          content: "No featured video is available for this game.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await safeReply(interaction, {
        content: `Warning: videos may contain spoilers. ${videoUrl}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "nowplaying") {
      const modal = new ModalBuilder()
        .setCustomId(`gamedb-nowplaying-modal:${gameId}`)
        .setTitle("Add to Now Playing")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("gamedb-nowplaying-note")
              .setLabel("Note (optional)")
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(false)
              .setMaxLength(MAX_NOW_PLAYING_NOTE_LEN),
          ),
        );
      await interaction.showModal(modal).catch(() => {});
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    if (action === "hltb-import") {
      const hltbCache = await getHltbCacheByGameId(gameId);
      if (isHltbImportEligible(game, Boolean(hltbCache))) {
        const scraped = await searchHltb(game.title);
        if (scraped) {
          await upsertHltbCache(gameId, {
            name: scraped.name,
            url: scraped.url,
            imageUrl: scraped.imageUrl ?? null,
            main: scraped.main,
            mainSides: scraped.mainSides,
            completionist: scraped.completionist,
            singlePlayer: scraped.singlePlayer,
            coOp: scraped.coOp,
            vs: scraped.vs,
            sourceQuery: game.title,
          });
        }
      }
      await this.refreshGameProfileMessage(interaction, gameId);
      return;
    }

    if (action === "completion") {
      const channel: any = interaction.channel;
      let thread: ThreadChannel | null = null;
      if ("isThread" in channel && typeof channel.isThread === "function" && channel.isThread()) {
        thread = channel as ThreadChannel;
      } else {
        const parentMessage = interaction.message;
        if (!parentMessage || typeof parentMessage.startThread !== "function") {
          await interaction.followUp({
            content: "Unable to start a thread from this message.",
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
          return;
        }

        const threadName = `${game.title} - Completion`;
        thread = await parentMessage.startThread({
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
      }

      const baseEmbed = this.getWizardBaseEmbed(interaction, "Completion Wizard");
      const wizardMessage = await thread.send({
        content: `<@${interaction.user.id}>`,
        embeds: [baseEmbed],
      });

      await this.runCompletionWizard(interaction, gameId, game.title, thread, wizardMessage);
      return;
    }

    if (action === "thread") {
      await this.runNowPlayingThreadWizard(interaction, gameId, game.title);
      return;
    }
  }

  @ModalComponent({ id: /^gamedb-nowplaying-modal:\d+$/ })
  async handleGameDbNowPlayingModal(interaction: ModalSubmitInteraction): Promise<void> {
    const [, gameIdRaw] = interaction.customId.split(":");
    const gameId = Number(gameIdRaw);
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await interaction.editReply({ content: "Invalid GameDB id." }).catch(() => {});
      return;
    }

    const game = await Game.getGameById(gameId);
    if (!game) {
      await interaction.editReply({ content: "That game was not found in GameDB." }).catch(() => {});
      return;
    }

    const noteRaw = stripModalInput(
      interaction.fields.getTextInputValue("gamedb-nowplaying-note"),
    );
    if (noteRaw.length > MAX_NOW_PLAYING_NOTE_LEN) {
      await interaction.editReply({
        content: `Note must be ${MAX_NOW_PLAYING_NOTE_LEN} characters or fewer.`,
      }).catch(() => {});
      return;
    }

    const note = noteRaw.length ? noteRaw : null;
    try {
      await Member.addNowPlaying(interaction.user.id, gameId, note);
      const nowPlaying = new NowPlayingCommand();
      await nowPlaying.showSingle(interaction, interaction.user, true);
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
        await interaction.editReply({
          content: `**${game.title}** is already in your Now Playing list.`,
        }).catch(() => {});
        return;
      }
      const msg = err?.message ?? "Failed to add to Now Playing.";
      await interaction.editReply({
        content: `Failed to add: ${msg}`,
      }).catch(() => {});
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
        const actionRow = this.buildGameProfileActionRow(
          gameId,
          profile.hasThread,
          profile.featuredVideoUrl,
          profile.canImportHltb,
        );
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
          embeds: [],
          files: profile.files,
          components: updatedComponents,
          flags: buildComponentsV2Flags(false),
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
    thread?: TextBasedChannel | ThreadChannel,
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
    const wizardSelect = async (
      question: string,
      options: Array<{ label: string; value: string }>,
    ): Promise<string | null> => {
      await updateEmbed(`Prompt: **${question}**`);
      const channel: any = thread ?? interaction.channel;
      if (!channel || typeof channel.send !== "function") {
        await updateEmbed("Cannot prompt for input in this channel.");
        return null;
      }

      const promptId = `gamedb-select:${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const select = new StringSelectMenuBuilder()
        .setCustomId(promptId)
        .setPlaceholder(question)
        .addOptions(options);
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      const promptMessage: Message | null = await channel.send({
        content: `<@${interaction.user.id}> ${question}`,
        components: [row],
        allowedMentions: { users: [interaction.user.id] },
      }).catch(() => null);
      if (!promptMessage) {
        await updateEmbed("Failed to send prompt.");
        return null;
      }

      try {
        const selection = await promptMessage.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: (i) => i.user.id === interaction.user.id && i.customId === promptId,
          time: 120_000,
        });
        await selection.deferUpdate().catch(() => {});
        const value = selection.values?.[0];
        await promptMessage.edit({ components: [] }).catch(() => {});
        if (!value) {
          await updateEmbed("No selection made.");
          return null;
        }
        const chosenLabel = options.find((opt) => opt.value === value)?.label ?? value;
        await updateEmbed(`Selected: *${chosenLabel}*`);
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

    const platforms = await Game.getPlatformsForGame(gameId);
    if (!platforms.length) {
      await updateEmbed("❌ No platform release data is available for this game.");
      return;
    }
    const baseOptions = platforms.map((platform) => ({
      label: platform.name.slice(0, 100),
      value: String(platform.id),
    }));
    const platformOptions = [
      ...baseOptions.slice(0, 24),
      { label: "Other", value: "other" },
    ];
    const platformChoice = await wizardSelect("Platform?", platformOptions);
    if (!platformChoice) return;
    const isOtherPlatform = platformChoice === "other";
    let platformId: number | null = null;
    if (!isOtherPlatform) {
      const parsedId = Number(platformChoice);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        await updateEmbed("❌ Invalid platform selection.");
        return;
      }
      platformId = parsedId;
    } else {
      await notifyUnknownCompletionPlatform(interaction, gameTitle, gameId);
    }

    let removeFromNowPlaying = false;
    const nowPlayingMeta = await Member.getNowPlayingEntryMeta(interaction.user.id, gameId);
    if (nowPlayingMeta) {
      const removeChoice = await wizardChoice(
        "Remove from your Now Playing list?",
        [
          { label: "Yes", value: "yes", style: ButtonStyle.Danger },
          { label: "No", value: "no" },
          { label: "Cancel", value: "cancel", style: ButtonStyle.Secondary },
        ],
      );
      if (removeChoice === null) return;
      if (removeChoice === "cancel") return;
      removeFromNowPlaying = removeChoice === "yes";
    }

    try {
      await Member.addCompletion({
        userId: interaction.user.id,
        gameId,
        completionType: completionType ?? "Main Story",
        platformId,
        completedAt,
        finalPlaytimeHours: playtime,
        note,
      });
      if (removeFromNowPlaying) {
        await Member.removeNowPlaying(interaction.user.id, gameId).catch(() => {});
      }
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

  @Slash({ description: "Search for a game", name: "search" })
  async search(
    @SlashOption({
      description: "Search query (game title).",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    query: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    try {
      const searchTerm = sanitizeUserInput(query, { preserveNewlines: false });
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

    const response = this.buildSearchResponse(
      sessionId,
      GAME_SEARCH_SESSIONS.get(sessionId)!,
      0,
      true,
    );

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

    const response = this.buildSearchResponse(sessionId, session, page, false);
    const actionRow = this.buildGameProfileActionRow(
      gameId,
      profile.hasThread,
      profile.featuredVideoUrl,
      profile.canImportHltb,
    );

    try {
      await interaction.editReply({
        embeds: [],
        files: profile.files,
        components: [...profile.components, actionRow, ...response.components],
        flags: response.flags,
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

    const response = this.buildSearchResponse(sessionId, session, newPage, true);

    try {
      await interaction.editReply(response);
    } catch {
      // ignore
    }
  }

  private buildSearchResponse(
    sessionId: string,
    session: { userId: string; results: any[]; query: string },
    page: number,
    includeList: boolean,
  ): { components: Array<ContainerBuilder | ActionRowBuilder<any>>; flags: number } {
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
    const titleCounts = new Map<string, number>();
    session.results.forEach((game) => {
      const title = String(game.title ?? "");
      titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    });
    const resultList = displayedResults.map((game) => {
      const title = String(game.title ?? "");
      const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
      if (!isDuplicate) {
        return `• **${title}**`;
      }
      const releaseDate = game.initialReleaseDate as Date | null | undefined;
      const year = releaseDate instanceof Date
        ? releaseDate.getFullYear()
        : releaseDate
          ? new Date(releaseDate).getFullYear()
          : null;
      const yearText = year ? ` (${year})` : " (Unknown Year)";
      return `• **${title}**${yearText}`;
    }).join("\n");

    const title = session.query
      ? `Search Results for "${session.query}" (Page ${safePage + 1}/${totalPages})`
      : `All Games (Page ${safePage + 1}/${totalPages})`;

    const selectCustomId = `gamedb-search-select:${sessionId}:${session.userId}:${safePage}`;
    const options = displayedResults.map((game) => {
      const title = String(game.title ?? "");
      const isDuplicate = (titleCounts.get(title) ?? 0) > 1;
      let label = title;
      if (isDuplicate) {
        const releaseDate = game.initialReleaseDate as Date | null | undefined;
        const year = releaseDate instanceof Date
          ? releaseDate.getFullYear()
          : releaseDate
            ? new Date(releaseDate).getFullYear()
            : null;
        const yearText = year ? ` (${year})` : " (Unknown Year)";
        label = `${title}${yearText}`;
      }
      return {
        label: label.substring(0, 100),
        value: String(game.id),
        description: "View this game",
      };
    });

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
    const components: Array<ContainerBuilder | ActionRowBuilder<any>> = [];
    if (includeList) {
      const listText = resultList || "No results.";
      const content = this.trimTextDisplayContent(
        `## ${title}\n\n${listText}\n\n*${session.results.length} results total*`,
      );
      const container = new ContainerBuilder().addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content),
      );
      components.push(container);
    }
    components.push(selectRow);

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(buttonRow);
    }

    return {
      components,
      flags: buildComponentsV2Flags(false),
    };
  }
}
