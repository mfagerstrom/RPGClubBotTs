import type {
  CommandInteraction,
  TextBasedChannel,
  StringSelectMenuInteraction,
} from "discord.js";
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import {
  Discord,
  SelectMenuComponent,
  Slash,
  SlashChoice,
  SlashGroup,
  SlashOption,
} from "discordx";
// Use relative import with .js for ts-node ESM compatibility
import Gotm, { IGotmEntry } from "../classes/Gotm.js";
import { safeDeferReply, safeReply, sanitizeUserInput } from "../functions/InteractionUtils.js";
import {
  areNominationsClosed,
  getUpcomingNominationWindow,
} from "../functions/NominationWindow.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
  upsertNomination,
} from "../classes/Nomination.js";
import { GOTM_NOMINATION_CHANNEL_ID } from "../config/nominationChannels.js";
import { buildGotmHelpResponse } from "./help.command.js";
import { igdbService } from "../services/IgdbService.js";
import {
  createIgdbSession,
  deleteIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";
import axios from "axios";
import Game, { type IGame } from "../classes/Game.js";
import {
  buildComponentsV2Flags,
  buildNominationListPayload,
} from "../functions/NominationListComponents.js";
import {
  buildGotmCardsFromEntries,
  buildGotmSearchMessages,
} from "../functions/GotmSearchComponents.js";
import { GameDb } from "./gamedb.command.js";

// Precompute dropdown choices
const MONTH_CHOICES = [
  { name: "January", value: "January" },
  { name: "February", value: "February" },
  { name: "March", value: "March" },
  { name: "April", value: "April" },
  { name: "May", value: "May" },
  { name: "June", value: "June" },
  { name: "July", value: "July" },
  { name: "August", value: "August" },
  { name: "September", value: "September" },
  { name: "October", value: "October" },
  { name: "November", value: "November" },
  { name: "December", value: "December" },
] as const;

const YEAR_CHOICES = (() => {
  try {
    const entries = Gotm.all();
    const years = Array.from(
      new Set(
        entries
          .map((e) => {
            const m = e.monthYear.match(/(\d{4})$/);
            return m ? Number(m[1]) : null;
          })
          .filter((n): n is number => n !== null),
      ),
    ).sort((a, b) => b - a);
    return years.map((y) => ({ name: y.toString(), value: y }));
  } catch {
    return [] as { name: string; value: number }[];
  }
})();

@Discord()
@SlashGroup({ description: "Game of the Month commands", name: "gotm" })
@SlashGroup("gotm")
export class GotmSearch {
  @Slash({ description: "Show help for GOTM commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
    const response = buildGotmHelpResponse();
    await safeReply(interaction, { ...response, flags: MessageFlags.Ephemeral });
  }

  @Slash({ description: "Search Game of the Month (GOTM)", name: "search" })
  async search(
    @SlashOption({
      description: "Round number (takes precedence if provided)",
      name: "round",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number | undefined,
    @SlashChoice(...YEAR_CHOICES as any)
    @SlashOption({
      description: "Year (e.g., 2023). Use with month for specific month.",
      name: "year",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    year: number | undefined,
    @SlashChoice(...MONTH_CHOICES as any)
    @SlashOption({
      description: "Month name or number (e.g., March or 3). Requires year.",
      name: "month",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    month: string | undefined,
  @SlashOption({
    description: "Search by title substring",
    name: "title",
    required: false,
    type: ApplicationCommandOptionType.String,
  })
  title: string | undefined,
  @SlashOption({
    description: "If true, show results in the channel instead of ephemerally.",
    name: "showinchat",
    required: false,
    type: ApplicationCommandOptionType.Boolean,
  })
  showInChat: boolean | undefined,
  interaction: CommandInteraction,
): Promise<void> {
    month = month ? sanitizeUserInput(month, { preserveNewlines: false }) : undefined;
    title = title ? sanitizeUserInput(title, { preserveNewlines: false }) : undefined;
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(ephemeral) });

    // Determine search mode
    let results: IGotmEntry[] = [];
    let criteriaLabel: string | undefined;

    try {
      if (round !== undefined && round !== null) {
        results = Gotm.getByRound(Number(round));
        criteriaLabel = `Round ${round}`;
      } else if (title && title.trim().length > 0) {
        results = Gotm.searchByTitle(title);
        criteriaLabel = `Title contains "${title}"`;
      } else if (year !== undefined && year !== null) {
        if (month && month.trim().length > 0) {
          const monthValue = parseMonthValue(month);
          results = Gotm.getByYearMonth(Number(year), monthValue);
          const monthLabel = typeof monthValue === 'number' ? monthValue.toString() : monthValue;
          criteriaLabel = `Year ${year}, Month ${monthLabel}`;
        } else {
          results = Gotm.getByYear(Number(year));
          criteriaLabel = `Year ${year}`;
        }
      } else {
        // Default: show current round (highest round number in data)
        const all = Gotm.all();
        if (!all.length) {
          await safeReply(interaction, { content: "No GOTM data available.", flags: MessageFlags.Ephemeral });
          return;
        }
        const currentRound = Math.max(...all.map((e) => e.round));
        results = Gotm.getByRound(currentRound);
        // no criteriaLabel so the embed omits the query line
      }

      if (!results || results.length === 0) {
        await safeReply(interaction, { content: `No GOTM entries found for ${criteriaLabel}.`, flags: MessageFlags.Ephemeral });
        return;
      }

      const cards = buildGotmCardsFromEntries(results, "GOTM");
      const payloads = await buildGotmSearchMessages(
        interaction.client,
        cards,
        {
          title: "GOTM Search Results",
          continuationTitle: "GOTM Search Results (continued)",
          emptyMessage: "No GOTM games found for this query.",
          queryLabel: criteriaLabel,
          guildId: interaction.guildId ?? undefined,
          maxGamesPerContainer: 10,
        },
      );
      for (let i = 0; i < payloads.length; i += 1) {
        const payload = payloads[i];
        await safeReply(interaction, {
          components: payload.components,
          files: payload.files.length ? payload.files : undefined,
          flags: buildComponentsV2Flags(ephemeral),
          ...(i > 0 ? { __forceFollowUp: true } : {}),
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, { content: `Error processing request: ${msg}`, flags: MessageFlags.Ephemeral });
    }
  }

  @Slash({
    description: "Nominate a game for the upcoming GOTM round",
    name: "nominate",
  })
  async nominate(
    @SlashOption({
      description: "Game title to nominate",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Reason for your nomination (max 250 chars)",
      name: "reason",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    reason: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const cleanedTitle = sanitizeUserInput(title, { preserveNewlines: false });
    if (!cleanedTitle) {
      await safeReply(interaction, {
        content: "Please provide a non-empty game title to nominate.",
                flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const trimmedReason = typeof reason === "string"
      ? sanitizeUserInput(reason, { preserveNewlines: true, maxLength: 250 })
      : "";
    if (trimmedReason.length > 250) {
      await safeReply(interaction, {
        content: "Reason must be 250 characters or fewer.",
                flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
        await safeReply(interaction, {
          content:
            `Nominations for Round ${window.targetRound} are closed. ` +
            `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
                  flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const game = await resolveGameDbGame(interaction, cleanedTitle);
      if (!game) return;

      const userId = interaction.user.id;
      const existing = await getNominationForUser("gotm", window.targetRound, userId);
      const saved = await upsertNomination(
        "gotm",
        window.targetRound,
        userId,
        game.id,
        trimmedReason || null,
      );

      const replaced =
        existing && existing.gameTitle !== saved.gameTitle
          ? ` (replaced "${existing.gameTitle}")`
          : existing
            ? " (no change to title)"
            : "";

      await safeReply(interaction, {
        content:
          `${existing ? "Updated" : "Recorded"} your GOTM nomination for Round ${
            window.targetRound
          }: "${saved.gameTitle}".${replaced}`,
                flags: MessageFlags.Ephemeral,
      });

      const nominations = await listNominationsForRound("gotm", window.targetRound);
      const payload = await buildNominationListPayload(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
        false,
      );
      await announceNomination("GOTM", interaction, payload);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not save your nomination: ${msg}`,
                flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Delete your GOTM nomination for the upcoming round",
    name: "delete-nomination",
  })
  async deleteNomination(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    try {
      const window = await getUpcomingNominationWindow();
      if (areNominationsClosed(window)) {
      await safeReply(interaction, {
        content:
          `Nominations for Round ${window.targetRound} are closed. ` +
            `Voting is scheduled for ${window.nextVoteAt.toLocaleString()}.`,
                flags: MessageFlags.Ephemeral,
      });
        return;
      }

      const userId = interaction.user.id;
      const existing = await getNominationForUser("gotm", window.targetRound, userId);
      if (!existing) {
        await safeReply(interaction, {
          content: `You do not have a GOTM nomination for Round ${window.targetRound}.`,
                  flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await deleteNominationForUser("gotm", window.targetRound, userId);
      const nominations = await listNominationsForRound("gotm", window.targetRound);
      await safeReply(interaction, {
        content: `Deleted your GOTM nomination for Round ${window.targetRound}: "${existing.gameTitle}".`,
                flags: MessageFlags.Ephemeral,
      });

      const payload = await buildNominationListPayload(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
        false,
      );
      await announceNomination("GOTM", interaction, payload);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not delete your nomination: ${msg}`,
                flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "List current GOTM nominations for the upcoming round",
    name: "noms",
  })
  async listNominations(
    @SlashOption({
      description: "Use the alternate layout (media on top, text below).",
      name: "alt_layout",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    altLayout: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: buildComponentsV2Flags(false) });

    try {
      const window = await getUpcomingNominationWindow();
      const nominations = await listNominationsForRound("gotm", window.targetRound);
      const payload = await buildNominationListPayload(
        "GOTM",
        "/gotm nominate",
        window,
        nominations,
        Boolean(altLayout),
      );
      await safeReply(interaction, {
        components: payload.components,
        files: payload.files,
        flags: buildComponentsV2Flags(false),
        allowedMentions: { parse: [] },
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not list nominations: ${msg}`,
        flags: buildComponentsV2Flags(false),
      });
    }
  }

  @SelectMenuComponent({ id: /^gotm-nom-details:\d+$/ })
  async showNominationDetails(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    const gameId = Number(interaction.values?.[0]);
    if (!Number.isInteger(gameId) || gameId <= 0) {
      await safeReply(interaction, {
        content: "Invalid GameDB id.",
        flags: buildComponentsV2Flags(true),
      });
      return;
    }
    const gameDb = new GameDb();
    await gameDb.showGameProfileFromNomination(interaction, gameId);
  }

}

async function announceNomination(
  kindLabel: string,
  interaction: CommandInteraction,
  payload: Awaited<ReturnType<typeof buildNominationListPayload>>,
): Promise<void> {
  const channelId = GOTM_NOMINATION_CHANNEL_ID;
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    const textChannel: TextBasedChannel | null = channel?.isTextBased()
      ? (channel as TextBasedChannel)
      : null;
    if (!textChannel || !isSendableTextChannel(textChannel)) return;
    await textChannel.send({
      components: payload.components,
      files: payload.files,
      flags: buildComponentsV2Flags(false),
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`Failed to announce ${kindLabel} nomination in channel ${channelId}:`, err);
  }
}

async function resolveGameDbGame(interaction: CommandInteraction, title: string): Promise<IGame | null> {
  const searchTerm = title.trim();
  const existing = await Game.searchGames(searchTerm);
  const exact = existing.find((g) => g.title.toLowerCase() === searchTerm.toLowerCase());
  if (exact) return exact;
  if (existing.length === 1) return existing[0] ?? null;

  let igdbResults: Awaited<ReturnType<typeof igdbService.searchGames>>["results"] = [];
  try {
    igdbResults = (await igdbService.searchGames(searchTerm)).results;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    await safeReply(interaction, {
      content: `IGDB search failed: ${msg}. Tag @merph518 if you need help importing.`,
              flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (!igdbResults.length) {
    await safeReply(interaction, {
      content:
        `No GameDB entry found and IGDB search returned no results for "${searchTerm}". ` +
        "Use /gamedb add to import first (tag @merph518 if you need help).",
              flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (igdbResults.length === 1) {
    return await importGameFromIgdb(interaction, igdbResults[0].id);
  }

  const opts: IgdbSelectOption[] = igdbResults.map((game) => {
    const year = game.first_release_date
      ? new Date(game.first_release_date * 1000).getFullYear()
      : "TBD";
    return {
      id: game.id,
      label: `${game.name} (${year})`,
      description: (game.summary || "No summary").substring(0, 95),
    };
  });

  return await new Promise<IGame | null>((resolve) => {
    const { components, sessionId } = createIgdbSession(
      interaction.user.id,
      opts,
      async (sel, igdbId) => {
        const imported = await importGameFromIgdb(interaction, igdbId);
        deleteIgdbSession(sessionId);
        finish(imported);
        if (imported) {
          try {
            await sel.update({ content: `Imported **${imported.title}**.`, components: [] });
          } catch {
            // ignore
          }
        }
      },
    );

    const timeout = setTimeout(async () => {
      deleteIgdbSession(sessionId);
      finish(null);
      await safeReply(interaction, {
        content:
          "Import cancelled or timed out. Nominations must be in GameDB first. " +
          "Use /gamedb add to import (tag @merph518 if you have trouble).",
                flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }, 120000);

    safeReply(interaction, {
      content: "Game not found in GameDB. Select the IGDB match to import.",
      components,
              flags: MessageFlags.Ephemeral,
      __forceFollowUp: true,
    });

    const finish = (value: IGame | null) => {
      clearTimeout(timeout);
      resolve(value);
    };
  });
}

async function importGameFromIgdb(
  interaction: CommandInteraction,
  igdbId: number,
): Promise<IGame | null> {
  const existing = await Game.getGameByIgdbId(igdbId);
  if (existing) return existing;

  const details = await igdbService.getGameDetails(igdbId);
  if (!details) {
    await safeReply(interaction, {
      content: `Could not fetch IGDB details for id ${igdbId}.`,
              flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  let imageData: Buffer | null = null;
  if (details.cover?.image_id) {
    try {
      const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
      const resp = await axios.get(imageUrl, { responseType: "arraybuffer" });
      imageData = Buffer.from(resp.data);
    } catch {
      // ignore image failures
    }
  }

  const igdbUrl = details.url || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);

  const newGame = await Game.createGame(
    details.name,
    details.summary || null,
    imageData,
    details.id,
    details.slug,
    details.total_rating ?? null,
    igdbUrl,
    Game.getFeaturedVideoUrl(details),
  );

  await Game.saveFullGameMetadata(newGame.id, details);
  const igdbPlatformIds: number[] = (details.platforms ?? [])
    .map((platform) => platform.id)
    .filter((id) => Number.isInteger(id) && id > 0);
  await Game.addGamePlatformsByIgdbIds(newGame.id, igdbPlatformIds);
  await processReleaseDates(newGame.id, details.release_dates || []);

  return newGame;
}

async function processReleaseDates(
  gameId: number,
  releaseDates: any[],
): Promise<void> {
  if (!releaseDates || !Array.isArray(releaseDates)) {
    return;
  }

  const platformIds: number[] = [];
  for (const release of releaseDates) {
    const platformId: number | null =
      typeof release.platform === "number" ? release.platform : release.platform?.id ?? null;
    if (platformId) {
      platformIds.push(platformId);
    }
  }
  const uniquePlatformIds: number[] = Array.from(new Set(platformIds));
  const platformMap = await Game.getPlatformsByIgdbIds(uniquePlatformIds);
  const missingPlatformIds = uniquePlatformIds.filter((id) => !platformMap.has(id));
  if (missingPlatformIds.length) {
    console.warn(
      `[GOTM] Missing IGDB platform IDs in GAMEDB_PLATFORMS: ${missingPlatformIds.join(", ")}`,
    );
  }

  for (const release of releaseDates) {
    const platformId: number | null =
      typeof release.platform === "number" ? release.platform : release.platform?.id ?? null;
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
    } catch {
      // ignore individual release failures
    }
  }
}

type SendableTextChannel = TextBasedChannel & {
  send: (content: any) => Promise<any>;
};

function isSendableTextChannel(channel: TextBasedChannel | null): channel is SendableTextChannel {
  return Boolean(channel && typeof (channel as any).send === "function");
}

function parseMonthValue(input: string): number | string {
  const trimmed = input.trim();
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= 12) return num;
  return trimmed;
}
