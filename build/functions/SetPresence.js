import { ActivityType } from "discord.js";
import fs from "node:fs/promises";
import path from "node:path";
const presenceFilePath = path.resolve(process.cwd(), "src", "data", "presence.json");
async function savePresenceToFile(activityName) {
    const data = { activityName };
    try {
        await fs.mkdir(path.dirname(presenceFilePath), { recursive: true });
        await fs.writeFile(presenceFilePath, JSON.stringify(data, null, 2), "utf8");
        console.log("Presence data saved to presence.json.");
    }
    catch (error) {
        console.error("Error saving presence data to file:", error);
    }
}
async function readPresenceFromFile() {
    try {
        const content = await fs.readFile(presenceFilePath, "utf8");
        const trimmed = content.trim();
        if (!trimmed)
            return null;
        const json = JSON.parse(trimmed);
        if (json && typeof json.activityName === "string" && json.activityName.trim().length > 0) {
            return json.activityName;
        }
        return null;
    }
    catch (error) {
        if (error?.code === "ENOENT") {
            return null;
        }
        console.error("Error reading presence data from file:", error);
        return null;
    }
}
export async function setPresence(interaction, activityName) {
    interaction.client.user.setPresence({
        activities: [{
                name: activityName,
                type: ActivityType.Playing,
            }],
        status: "online",
    });
    await savePresenceToFile(activityName);
}
export async function updateBotPresence(bot) {
    const activityName = await readPresenceFromFile();
    if (activityName) {
        bot.user.setPresence({
            activities: [
                {
                    name: activityName,
                    type: ActivityType.Playing,
                },
            ],
            status: "online",
        });
        console.log("Bot presence updated from presence.json.");
    }
    else {
        console.log("No presence data found in presence.json.");
    }
}
