import { ActivityType, CommandInteraction } from "discord.js";
import fs from 'fs';

export async function setPresence(interaction: CommandInteraction, activityName: string) {
    interaction.client.user!.setPresence({
        activities: [{
            name: activityName,
            type: ActivityType.Playing,
        }],
        status: 'online',
    });

    const presenceJSON = JSON.stringify(activityName);
    fs.writeFile('./src/data/presence.json', presenceJSON, (err) => {
        if (err) {
            console.log('Error writing file:', err);
        }
    });
}