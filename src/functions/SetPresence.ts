import { ActivityType, Client, CommandInteraction } from "discord.js";
import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";

const PRESENCE_TABLE = "BOT_PRESENCE_HISTORY";

async function savePresenceToDatabase(
  interaction: CommandInteraction,
  activityName: string,
): Promise<void> {
  try {
    const pool = getOraclePool();
    const connection = await pool.getConnection();

    try {
      await connection.execute(
        `INSERT INTO ${PRESENCE_TABLE} (ACTIVITY_NAME, SET_AT, SET_BY_USER_ID, SET_BY_USERNAME)
         VALUES (:activityName, SYSTIMESTAMP, :userId, :username)`,
        {
          activityName,
          userId: interaction.user?.id ?? null,
          username: interaction.user?.tag ?? null,
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

async function readLatestPresenceFromDatabase(): Promise<string | null> {
  try {
    const pool = getOraclePool();
    const connection = await pool.getConnection();

    try {
      const result = await connection.execute<{ ACTIVITY_NAME: string }>(
        `SELECT ACTIVITY_NAME
           FROM ${PRESENCE_TABLE}
          ORDER BY SET_AT DESC
          FETCH FIRST 1 ROW ONLY`,
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );

      const rows = result.rows ?? [];
      if (!rows.length) {
        return null;
      }

      const row = rows[0] as any;
      const activityName = row.ACTIVITY_NAME;
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

export interface PresenceHistoryEntry {
  activityName: string;
  setAt: Date | null;
  setByUserId: string | null;
  setByUsername: string | null;
}

export async function getPresenceHistory(limit: number): Promise<PresenceHistoryEntry[]> {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;

  try {
    const pool = getOraclePool();
    const connection = await pool.getConnection();

    try {
      const result = await connection.execute<{
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

      const rows = (result.rows ?? []) as any[];
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

export async function setPresence(interaction: CommandInteraction, activityName: string) {
  interaction.client.user!.setPresence({
    activities: [
      {
        name: activityName,
        type: ActivityType.Playing,
      },
    ],
    status: "online",
  });

  await savePresenceToDatabase(interaction, activityName);
}

export async function updateBotPresence(bot: Client) {
  const activityName = await readLatestPresenceFromDatabase();
  if (activityName) {
    bot.user!.setPresence({
      activities: [
        {
          name: activityName,
          type: ActivityType.Playing,
        },
      ],
      status: "online",
    });
    console.log("Bot presence updated from database.");
  } else {
    console.log("No presence data found in database.");
  }
}
