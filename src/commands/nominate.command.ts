// import { ApplicationCommandOptionType } from "discord.js";
// import type { CommandInteraction } from "discord.js";
// import { Discord, Slash, SlashGroup, SlashOption } from "discordx";

// @Discord()
// @SlashGroup({ description: "Nomination Commands", name: "nom" })
// @SlashGroup("nom")
// export class Nominate {
//   @Slash({ description: "Nominate a game for GOTM", name: "gotm" })
//   async gotm(
//     @SlashOption({
//       description: "What is the title of the game you'd like to nominate?",
//       name: "text",
//       required: true,
//       type: ApplicationCommandOptionType.String,
//     })
//     text: string,
//     interaction: CommandInteraction
//   ): Promise<void> {
//     let currentNoms: Nomination[] = await getCurrentNominations();

//     let userHasAlreadyNominated: boolean = false;
//     for (let x: number = 0; x < currentNoms.length; x++) {
//       if (currentNoms[x].nominator === interaction.user.id) {
//         userHasAlreadyNominated = true;
//       }
//     }

//     if (userHasAlreadyNominated) {
//       await interaction.reply({
//         content: `You have already nominated a game for this round.  If you wish to change it, delete your nomination and try again.`
//       });
//     } else {
//       const newNom: Nomination = {
//         title: text,
//         nominator: interaction.user.id
//       };

//       const newNoms = currentNoms;
//       newNoms.push(newNom);

//       await interaction.reply({
//         content: `Your nomination for ${text} has been recorded.\n\n${await getGotmNominations()}`
//       });
//     }
//   }

//   @Slash({ description: "Output current GOTM Nominations", name: "gotm_list" })
//   async gotm_list(
//     interaction: CommandInteraction
//   ): Promise<void> {
//     const gotmNoms: string = await getCurrentNominations();
//     await interaction.reply({
//       content: gotmNoms,
//     });
//   }

//   @Slash({ description: "Output current GOTM Nominations", name: "gotm_delete_my_nomination" })
//   async gotm_delete_my_nomination(
//     interaction: CommandInteraction
//   ): Promise<void> {
//     let currentNoms: Nomination[] = await getCurrentNominations();

//     for (let x: number = 0; x < currentNoms.length; x++) {
//       if (currentNoms[x].nominator === interaction.user.id) {
//         currentNoms = currentNoms.filter(obj => { return obj !== currentNoms[x] });
//       }
//     }

//     await interaction.reply({
//       content: `Your nomination has been deleted.`
//     });
//   }

//   @Slash({ description: "Nominate a game for NR-GOTM", name: "nr_gotm" })
//   async nr_gotm(
//     @SlashOption({
//       description: "What is the title of the game you'd like to nominate?",
//       name: "text",
//       required: true,
//       type: ApplicationCommandOptionType.String,
//     })
//     text: string,
//     interaction: CommandInteraction
//   ): Promise<void> {
//     await interaction.reply({
//       content: `This is under construction, but soon you'll be able to use this command to nominate ${text} for the next NR-GOTM vote.`
//     });
//   }
// }

// interface Nomination {
//   title: string,
//   nominator: string
// }