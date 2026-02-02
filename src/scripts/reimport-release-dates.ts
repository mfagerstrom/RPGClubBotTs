import "dotenv/config";
import { initOraclePool, getOraclePool } from "../db/oracleClient.js";
import Game from "../classes/Game.js";
import oracledb from "oracledb";

type ScriptMode = "dry-run" | "write";

interface IGameWithIgdb {
  gameId: number;
  title: string;
  igdbId: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function getGamesWithIgdbIds(): Promise<IGameWithIgdb[]> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute<{
      GAME_ID: number;
      TITLE: string;
      IGDB_ID: number;
    }>(
      `SELECT GAME_ID, TITLE, IGDB_ID
         FROM GAMEDB_GAMES
        WHERE IGDB_ID IS NOT NULL
        ORDER BY GAME_ID`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );

    return (result.rows ?? []).map((row) => ({
      gameId: Number(row.GAME_ID),
      title: String(row.TITLE),
      igdbId: Number(row.IGDB_ID),
    }));
  } finally {
    await connection.close();
  }
}

async function deleteGameReleases(gameId: number): Promise<number> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    const result = await connection.execute(
      `DELETE FROM GAMEDB_RELEASES WHERE GAME_ID = :gameId`,
      { gameId },
      { autoCommit: true },
    );
    return Number(result.rowsAffected ?? 0);
  } finally {
    await connection.close();
  }
}

async function clearInitialReleaseDate(gameId: number): Promise<void> {
  const pool = getOraclePool();
  const connection = await pool.getConnection();
  try {
    await connection.execute(
      `UPDATE GAMEDB_GAMES
          SET INITIAL_RELEASE_DATE = NULL
        WHERE GAME_ID = :gameId`,
      { gameId },
      { autoCommit: true },
    );
  } finally {
    await connection.close();
  }
}

async function reimportReleaseDates(
  games: IGameWithIgdb[],
  mode: ScriptMode,
): Promise<void> {
  let processed = 0;
  let cleared = 0;
  let imported = 0;
  let failed = 0;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  console.log(`Total games with IGDB IDs: ${games.length}`);
  console.log(`${"=".repeat(60)}\n`);

  for (const game of games) {
    processed++;
    const progress = `[${processed}/${games.length}]`;

    try {
      if (mode === "write") {
        const deletedCount = await deleteGameReleases(game.gameId);
        if (deletedCount > 0) {
          cleared++;
          console.log(
            `${progress} Cleared ${deletedCount} release(s) for "${game.title}" (ID: ${game.gameId})`,
          );
        }

        await clearInitialReleaseDate(game.gameId);

        await Game.importReleaseDatesFromIgdb(game.gameId, game.igdbId);
        imported++;
        console.log(
          `${progress} ✓ Imported release dates for "${game.title}" (ID: ${game.gameId})`,
        );
      } else {
        const releases = await Game.getGameReleases(game.gameId);
        console.log(
          `${progress} [DRY RUN] Would clear ${releases.length} release(s) and reimport for "${game.title}" (ID: ${game.gameId})`,
        );
      }

      // Rate limiting to avoid overwhelming IGDB API
      if (processed % 10 === 0) {
        await sleep(500);
      } else {
        await sleep(100);
      }
    } catch (err: any) {
      failed++;
      console.error(
        `${progress} ✗ Failed to process "${game.title}" (ID: ${game.gameId}): ${err?.message ?? err}`,
      );
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Total processed: ${processed}`);
  if (mode === "write") {
    console.log(`  Games cleared: ${cleared}`);
    console.log(`  Games imported: ${imported}`);
    console.log(`  Failed: ${failed}`);
  } else {
    console.log(`  (Dry run - no changes made)`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args[0]?.toLowerCase();
  const mode: ScriptMode = modeArg === "write" ? "write" : "dry-run";

  if (mode === "dry-run") {
    console.log("\n⚠️  Running in DRY-RUN mode. No changes will be made.");
    console.log("   Use 'npm run script:reimport-releases write' to execute.\n");
  } else {
    console.log("\n⚠️  Running in WRITE mode. This will modify the database!");
    console.log("   Press Ctrl+C within 5 seconds to cancel...\n");
    await sleep(5000);
  }

  await initOraclePool();

  try {
    const games = await getGamesWithIgdbIds();
    if (!games.length) {
      console.log("No games with IGDB IDs found.");
      return;
    }

    await reimportReleaseDates(games, mode);
  } catch (err: any) {
    console.error("Fatal error:", err?.message ?? err);
    process.exit(1);
  } finally {
    await getOraclePool().close();
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
