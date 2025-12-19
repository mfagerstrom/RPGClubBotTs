import { ActivityType, Client, type Activity } from "discord.js";
import type { AnyRepliable } from "./InteractionUtils.js";
import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

const PRESENCE_TABLE: string = "BOT_PRESENCE_HISTORY";

async function savePresenceToDatabase(
  activityName: string,
  userId: string | null,
  username: string | null,
): Promise<void> {
  try {
    const pool: oracledb.Pool = getOraclePool();
    const connection: oracledb.Connection = await pool.getConnection();

    try {
      await connection.execute(
        `INSERT INTO ${PRESENCE_TABLE} (ACTIVITY_NAME, SET_AT, SET_BY_USER_ID, SET_BY_USERNAME)
         VALUES (:activityName, SYSTIMESTAMP, :userId, :username)`,
        {
          activityName,
          userId,
          username,
        },
        { autoCommit: true },
      );
      console.log("Presence saved to database.");
    } finally {
      await connection.close();
    }
  } catch (error) {
    console.error("Error saving presence to database:", error);
  }
}

async function internalSetPresence(
  client: Client,
  activityName: string,
  userId: string | null = null,
  username: string | null = null,
  saveToDb: boolean = false,
): Promise<void> {
  client.user!.setPresence({
    activities: [
      {
        name: activityName,
        type: ActivityType.Playing,
      },
    ],
    status: "online",
  });

  if (saveToDb) {
    await savePresenceToDatabase(activityName, userId, username);
  }
}

async function readLatestPresenceFromDatabase(): Promise<string | null> {
  try {
    const pool: oracledb.Pool = getOraclePool();
    const connection: oracledb.Connection = await pool.getConnection();

    try {
      const result: oracledb.Result<{ ACTIVITY_NAME: string }> =
        await connection.execute<{ ACTIVITY_NAME: string }>(
          `SELECT ACTIVITY_NAME
             FROM ${PRESENCE_TABLE}
            ORDER BY SET_AT DESC
            FETCH FIRST 1 ROW ONLY`,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );

      const rows: { ACTIVITY_NAME: string }[] = result.rows ?? [];
      if (!rows.length) {
        return null;
      }

      const row: { ACTIVITY_NAME: string } = rows[0];
      const activityName: string = row.ACTIVITY_NAME;
      if (typeof activityName === "string" && activityName.trim().length > 0) {
        return activityName;
      }

      return null;
    } finally {
      await connection.close();
    }
  } catch (error) {
    console.error("Error reading presence from database:", error);
    return null;
  }
}

export interface IPresenceHistoryEntry {
  activityName: string;
  setAt: Date | null;
  setByUserId: string | null;
  setByUsername: string | null;
}

export async function getPresenceHistory(limit: number): Promise<IPresenceHistoryEntry[]> {
  const safeLimit: number = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;

  try {
    const pool: oracledb.Pool = getOraclePool();
    const connection: oracledb.Connection = await pool.getConnection();

    try {
      const result: oracledb.Result<{
        ACTIVITY_NAME: string;
        SET_AT: Date;
        SET_BY_USER_ID: string | null;
        SET_BY_USERNAME: string | null;
      }> = await connection.execute<{
        ACTIVITY_NAME: string;
        SET_AT: Date;
        SET_BY_USER_ID: string | null;
        SET_BY_USERNAME: string | null;
      }>(
        `SELECT ACTIVITY_NAME,
                SET_AT,
                SET_BY_USER_ID,
                SET_BY_USERNAME
           FROM ${PRESENCE_TABLE}
          ORDER BY SET_AT DESC
          FETCH FIRST :limit ROWS ONLY`,
        { limit: safeLimit },
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const rows: {
        ACTIVITY_NAME: string;
        SET_AT: Date;
        SET_BY_USER_ID: string | null;
        SET_BY_USERNAME: string | null;
      }[] = result.rows ?? [];
      return rows.map((row) => ({
        activityName: row.ACTIVITY_NAME,
        setAt: row.SET_AT ?? null,
        setByUserId: row.SET_BY_USER_ID ?? null,
        setByUsername: row.SET_BY_USERNAME ?? null,
      }));
    } finally {
      await connection.close();
    }
  } catch (error) {
    console.error("Error loading presence history from database:", error);
    return [];
  }
}

export async function setPresence(
  interaction: AnyRepliable,
  activityName: string,
): Promise<void> {
  await internalSetPresence(
    interaction.client,
    activityName,
    interaction.user?.id ?? null,
    interaction.user?.tag ?? null,
    true,
  );
}

export async function updateBotPresence(bot: Client): Promise<void> {
  const activityName: string | null = await readLatestPresenceFromDatabase();
  if (activityName) {
    await internalSetPresence(bot, activityName);
  } else {
    console.log("No presence data found in database.");
  }
}

export async function restorePresenceIfMissing(bot: Client): Promise<void> {
  const activities: readonly Activity[] = bot.user?.presence?.activities ?? [];
  const hasPresence: boolean = activities.some(
    (activity) => (activity.name ?? "").trim().length > 0,
  );
  if (hasPresence) {
    return;
  }

  const activityName: string | null = await readLatestPresenceFromDatabase();
  if (!activityName) {
    console.log("No presence data found in database to restore.");
    return;
  }

  await internalSetPresence(bot, activityName);
  console.log("Bot presence restored after detecting missing activity.");
}
