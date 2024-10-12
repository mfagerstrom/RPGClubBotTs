import { ActivityType } from "discord.js";
import { Client } from "discordx";

export async function setPresence(client: Client, activityName: string) {
    client.user!.setPresence({
        activities: [{
            name: activityName,
            type: ActivityType.Playing,
        }],
        status: 'online',
    });
}

interface discordPresence {
    activities: [{
        name: string,
        type: ActivityType.Playing,
    }],
    status: string,
}