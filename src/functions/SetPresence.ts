// import { ActivityType, Client, CommandInteraction } from "discord.js";
// import Presence from '../models/Presence.js';

// // export async function setPresence(interaction: CommandInteraction, activityName: string) {
// //     interaction.client.user!.setPresence({
// //         activities: [{
// //             name: activityName,
// //             type: ActivityType.Playing,
// //         }],
// //         status: 'online',
// //     });

// //     try {
// //         const presence = new Presence({ activityName });
// //         await presence.save();
// //         console.log('Presence data saved to MongoDB.');
// //     } catch (error) {
// //         console.error('Error saving presence data:', error);
// //     }
// // }

// export async function updateBotPresence(bot: Client) {
//     try {
//         const latestPresence = await Presence.findOne().sort({ timestamp: -1 }).exec();

//         if (latestPresence) {
//             bot.user!.setPresence({
//                 activities: [{
//                     name: latestPresence.activityName,
//                     type: ActivityType.Playing,
//                 }],
//                 status: 'online',
//             });
//             console.log('Bot presence updated from MongoDB.');
//         } else {
//             console.log('No presence data found in MongoDB.');
//         }
//     } catch (error) {
//         console.error('Error retrieving presence data:', error);
//     }
// }