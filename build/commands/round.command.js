var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import Gotm from "../classes/Gotm.js";
import NrGotm from "../classes/NrGotm.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed, } from "../functions/GotmEntryEmbeds.js";
let CurrentRoundCommand = class CurrentRoundCommand {
    async round(interaction) {
        await safeDeferReply(interaction);
        try {
            const current = await BotVotingInfo.getCurrentRound();
            if (!current) {
                await safeReply(interaction, {
                    content: "No voting round information is available.",
                    ephemeral: true,
                });
                return;
            }
            const roundNumber = current.roundNumber;
            const gotmEntries = Gotm.getByRound(roundNumber);
            const nrGotmEntries = NrGotm.getByRound(roundNumber);
            const gotmMonthYear = gotmEntries[0]?.monthYear;
            const nrGotmMonthYear = nrGotmEntries[0]?.monthYear;
            const hasGotm = gotmEntries.length > 0;
            const hasNrGotm = nrGotmEntries.length > 0;
            const currentDescLines = [];
            let mainLine = `Round ${roundNumber}`;
            if (gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear) {
                mainLine += ` - ${gotmMonthYear}`;
            }
            currentDescLines.push(mainLine);
            if (!gotmMonthYear && !nrGotmMonthYear) {
                // no extra month/year lines
            }
            else if (!(gotmMonthYear && nrGotmMonthYear && gotmMonthYear === nrGotmMonthYear)) {
                if (gotmMonthYear) {
                    currentDescLines.push(`GOTM: ${gotmMonthYear}`);
                }
                if (nrGotmMonthYear) {
                    currentDescLines.push(`NR-GOTM: ${nrGotmMonthYear}`);
                }
            }
            if (!hasGotm && !hasNrGotm) {
                currentDescLines.push("");
                currentDescLines.push("(No GOTM or NR-GOTM entries found for this round.)");
            }
            const currentEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle("Current Round:")
                .setDescription(currentDescLines.join("\n"));
            const embeds = [currentEmbed];
            if (hasGotm) {
                const gotmEntry = gotmEntries[0];
                const gotmEmbed = await buildGotmEntryEmbed(gotmEntry, interaction.guildId ?? undefined, interaction.client);
                gotmEmbed.setTitle("Game of the Month");
                // Ensure the title is not a clickable link
                gotmEmbed.setURL(null);
                embeds.push(gotmEmbed);
            }
            if (hasNrGotm) {
                const nrGotmEntry = nrGotmEntries[0];
                const nrEmbed = await buildNrGotmEntryEmbed(nrGotmEntry, interaction.guildId ?? undefined, interaction.client);
                nrEmbed.setTitle("Non-RPG Game of the Month");
                // Ensure the title is not a clickable link
                nrEmbed.setURL(null);
                embeds.push(nrEmbed);
            }
            await safeReply(interaction, {
                embeds,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error fetching current round information: ${msg}`,
                ephemeral: true,
            });
        }
    }
};
__decorate([
    Slash({
        description: "Show the current GOTM round and winners",
        name: "round",
    })
], CurrentRoundCommand.prototype, "round", null);
CurrentRoundCommand = __decorate([
    Discord()
], CurrentRoundCommand);
export { CurrentRoundCommand };
