import { ActivityType } from "discord.js";
import oracledb from "oracledb";
import { getOraclePool } from "../db/oracleClient.js";
const PRESENCE_TABLE = "BOT_PRESENCE_HISTORY";
async function savePresenceToDatabase(activityName, userId, username) {
    try {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            await connection.execute(`INSERT INTO ${PRESENCE_TABLE} (ACTIVITY_NAME, SET_AT, SET_BY_USER_ID, SET_BY_USERNAME)
         VALUES (:activityName, SYSTIMESTAMP, :userId, :username)`, {
                activityName,
                userId,
                username,
            }, { autoCommit: true });
            console.log("Presence saved to database.");
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        console.error("Error saving presence to database:", error);
    }
}
async function internalSetPresence(client, activityName, userId = null, username = null, saveToDb = false) {
    client.user.setPresence({
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
async function readLatestPresenceFromDatabase() {
    try {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ACTIVITY_NAME
             FROM ${PRESENCE_TABLE}
            ORDER BY SET_AT DESC
            FETCH FIRST 1 ROW ONLY`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = result.rows ?? [];
            if (!rows.length) {
                return null;
            }
            const row = rows[0];
            const activityName = row.ACTIVITY_NAME;
            if (typeof activityName === "string" && activityName.trim().length > 0) {
                return activityName;
            }
            return null;
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        console.error("Error reading presence from database:", error);
        return null;
    }
}
export async function getPresenceHistory(limit) {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 5;
    try {
        const pool = getOraclePool();
        const connection = await pool.getConnection();
        try {
            const result = await connection.execute(`SELECT ACTIVITY_NAME,
                SET_AT,
                SET_BY_USER_ID,
                SET_BY_USERNAME
           FROM ${PRESENCE_TABLE}
          ORDER BY SET_AT DESC
          FETCH FIRST :limit ROWS ONLY`, { limit: safeLimit }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            const rows = result.rows ?? [];
            return rows.map((row) => ({
                activityName: row.ACTIVITY_NAME,
                setAt: row.SET_AT ?? null,
                setByUserId: row.SET_BY_USER_ID ?? null,
                setByUsername: row.SET_BY_USERNAME ?? null,
            }));
        }
        finally {
            await connection.close();
        }
    }
    catch (error) {
        console.error("Error loading presence history from database:", error);
        return [];
    }
}
export async function setPresence(interaction, activityName) {
    await internalSetPresence(interaction.client, activityName, interaction.user?.id ?? null, interaction.user?.tag ?? null, true);
}
export async function updateBotPresence(bot) {
    const activityName = await readLatestPresenceFromDatabase();
    if (activityName) {
        await internalSetPresence(bot, activityName);
    }
    else {
        console.log("No presence data found in database.");
    }
}
