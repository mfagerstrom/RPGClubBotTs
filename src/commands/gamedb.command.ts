import {
  ApplicationCommandOptionType,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ComponentType,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../../src/functions/InteractionUtils.js";
import { isAdmin } from "../../src/commands/admin.command.js";
import Game from "../../src/classes/Game.js";
import axios from "axios"; // For downloading image attachments
import { igdbService } from "../../src/services/IgdbService.js";

@Discord()
@SlashGroup({ description: "Game Database Commands", name: "gamedb" })
@SlashGroup("gamedb")
export class GameDb {
  @Slash({ description: "Add a new game to the database (searches IGDB)", name: "add" })
  async add(
    @SlashOption({
      description: "Title of the game to search for",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    try {
      // 1. Search IGDB
      const results = await igdbService.searchGames(title);

      if (!results || results.length === 0) {
        await safeReply(interaction, {
          content: `No games found on IGDB matching "${title}".`,
          ephemeral: true,
        });
        return;
      }

      // 1b. Single Result - Auto Add
      if (results.length === 1) {
        await this.addGameToDatabase(interaction, results[0].id);
        return;
      }

      // 2. Build Select Menu
      const options = results.slice(0, 25).map((game) => {
        const year = game.first_release_date
          ? new Date(game.first_release_date * 1000).getFullYear()
          : "TBD";
        return {
          label: `${game.name} (${year})`.substring(0, 100),
          value: game.id.toString(),
          description: (game.summary || "No summary").substring(0, 100),
        };
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("gamedb-add-select")
        .setPlaceholder("Select the correct game")
        .addOptions(options);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const reply = await safeReply(interaction, {
        content: `Found ${results.length} results for "${title}". Please select one:`,
        components: [row],
        ephemeral: true,
      });

      if (!reply) return; // Should not happen given safeReply logic but safety first

      // 3. Wait for selection
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 60000, // 1 minute timeout
        filter: (i: any) => i.user.id === interaction.user.id,
      });

      collector.on("collect", async (i: StringSelectMenuInteraction) => {
        try {
          await i.deferUpdate(); // Acknowledge selection
          const selectedId = Number(i.values[0]);
          await this.addGameToDatabase(i, selectedId);
          collector.stop("selected");
        } catch (err: any) {
          console.error("Error in gamedb add selection:", err);
          await i.followUp({
            content: `An error occurred while adding the game: ${err.message}`,
            ephemeral: true,
          });
        }
      });

      collector.on("end", async (_collected: any, reason: string) => {
        if (reason !== "selected") {
          try {
            await interaction.editReply({
              content: "Selection timed out or cancelled.",
              components: [],
            });
          } catch {
            // Ignore if message deleted
          }
        }
      });

    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search IGDB. Error: ${error.message}`,
        ephemeral: true,
      });
    }
  }

  private async addGameToDatabase(
    interaction: CommandInteraction | StringSelectMenuInteraction,
    igdbId: number
  ): Promise<void> {
    // 4. Fetch Details
    const details = await igdbService.getGameDetails(igdbId);
    if (!details) {
      // If it's a component interaction, followUp is better for errors after deferUpdate
      // If it's command interaction, editReply is fine.
      // InteractionUtils.safeReply handles both somewhat, but let's be explicit for errors if needed.
      // We'll throw here and let caller handle, OR handle gracefully.
      // Caller expects void.
      const msg = "Failed to fetch details from IGDB.";
      if (interaction.isMessageComponent()) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.editReply({ content: msg });
      }
      return;
    }

    // 5. Download Image
    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const imageUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
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
    const newGame = await Game.createGame(
      details.name,
      details.summary || null,
      imageData,
      details.id,
      details.slug,
      details.total_rating ?? null,
      igdbUrl,
    );

    // 6a. Save Extended Metadata
    await Game.saveFullGameMetadata(newGame.id, details);

    // 6b. Process Releases
    await this.processReleaseDates(
      newGame.id,
      details.release_dates || [],
      details.platforms || [],
    );

    // 7. Final Success Message
    // We use editReply because both paths (command deferral, component deferUpdate) leave us in a state where editReply updates the original message.
    await interaction.editReply({
      content: `Successfully added **${newGame.title}** (ID: ${newGame.id}) to the database!`,
      components: [], // Remove dropdown if present
    });
  }

  @Slash({ description: "View details of a game", name: "view" })
  async view(
    @SlashOption({
      description: "ID of the game to view",
      name: "game_id",
      required: true,
      type: ApplicationCommandOptionType.Number,
    })
    gameId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const game = await Game.getGameById(gameId);
      if (!game) {
        await safeReply(interaction, {
          content: `No game found with ID ${gameId}.`,
          ephemeral: true,
        });
        return;
      }

      const releases = await Game.getGameReleases(gameId);
      const platforms = await Game.getAllPlatforms();
      const regions = await Game.getAllRegions();

      const platformMap = new Map(platforms.map((p) => [p.id, p.name]));
      const regionMap = new Map(regions.map((r) => [r.id, r.name]));

      const embed = new EmbedBuilder()
        .setTitle(game.title)
        .setDescription(game.description || "No description available.")
        .setColor(0x0099ff); // A nice blue color

      if (game.imageData) {
        // Discord.js embeds can use 'attachment://filename' for image URL
        // We'll attach the image Buffer directly and reference it.
        embed.setImage("attachment://game_image.png");
      }

      if (releases.length > 0) {
        const releaseField = releases.map(r => {
          const platformName = platformMap.get(r.platformId) || "Unknown Platform";
          const regionName = regionMap.get(r.regionId) || "Unknown Region";
          const releaseDate = r.releaseDate ? r.releaseDate.toLocaleDateString() : "TBD";
          const format = r.format ? `(${r.format})` : "";
          return `• **${platformName}** (${regionName}) ${format} - ${releaseDate}`;
        }).join("\n");
        embed.addFields({ name: "Releases", value: releaseField, inline: false });
      }

      // Fetch extended metadata
      const developers = await Game.getGameDevelopers(gameId);
      if (developers.length) embed.addFields({ name: "Developers", value: developers.join(", "), inline: true });

      const publishers = await Game.getGamePublishers(gameId);
      if (publishers.length) embed.addFields({ name: "Publishers", value: publishers.join(", "), inline: true });

      const genres = await Game.getGameGenres(gameId);
      if (genres.length) embed.addFields({ name: "Genres", value: genres.join(", "), inline: true });

      const themes = await Game.getGameThemes(gameId);
      if (themes.length) embed.addFields({ name: "Themes", value: themes.join(", "), inline: true });

      const modes = await Game.getGameModes(gameId);
      if (modes.length) embed.addFields({ name: "Game Modes", value: modes.join(", "), inline: true });

      const perspectives = await Game.getGamePerspectives(gameId);
      if (perspectives.length) embed.addFields({ name: "Player Perspectives", value: perspectives.join(", "), inline: true });

      const engines = await Game.getGameEngines(gameId);
      if (engines.length) embed.addFields({ name: "Game Engines", value: engines.join(", "), inline: true });

      const franchises = await Game.getGameFranchises(gameId);
      if (franchises.length) embed.addFields({ name: "Franchises", value: franchises.join(", "), inline: true });

      const series = await Game.getGameSeries(gameId);
      if (series) embed.addFields({ name: "Series / Collection", value: series, inline: true });

      if (game.totalRating) {
        embed.addFields({ name: "IGDB Rating", value: `${Math.round(game.totalRating)}/100`, inline: true });
      }

      if (game.igdbUrl) {
        embed.setURL(game.igdbUrl);
      }

      const files = game.imageData ? [{ attachment: game.imageData, name: "game_image.png" }] : [];

      await safeReply(interaction, {
        embeds: [embed],
        files: files,
      });

    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to retrieve game details. Error: ${error.message}`,
        ephemeral: true,
      });
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

  @Slash({ description: "Search for a game", name: "search" })
  async search(
    @SlashOption({
      description: "Search query (game title). Leave empty to list all.",
      name: "query",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    query: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    try {
      const searchTerm = (query ?? "").trim();
      const results = await Game.searchGames(searchTerm);

      if (results.length === 0) {
        await safeReply(interaction, {
          content: searchTerm
            ? `No games found matching "${searchTerm}".`
            : "No games found.",
          ephemeral: true,
        });
        return;
      }

      // Limit results to 25 to fit in an embed reasonably
      const displayedResults = results.slice(0, 25);
      const resultList = displayedResults
        .map((g) => `• **${g.title}**`)
        .join("\n");

      const title = searchTerm
        ? `Search Results for "${searchTerm}"`
        : "All Games";

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(resultList || "No results.")
        .setFooter({
          text:
            results.length > 25
              ? `Showing 25 of ${results.length} results`
              : `${results.length} results found`,
        });

      await safeReply(interaction, {
        embeds: [embed],
      });
    } catch (error: any) {
      await safeReply(interaction, {
        content: `Failed to search games. Error: ${error.message}`,
        ephemeral: true,
      });
    }
  }
}
