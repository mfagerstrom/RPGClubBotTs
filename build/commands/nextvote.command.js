var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { EmbedBuilder, ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
let NextVoteCommand = class NextVoteCommand {
    async nextvote(showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });
        try {
            const current = await BotVotingInfo.getCurrentRound();
            if (!current || !current.nextVoteAt) {
                await safeReply(interaction, {
                    content: "No next vote information is available.",
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            let dateText;
            if (current.nextVoteAt instanceof Date) {
                dateText = current.nextVoteAt.toLocaleDateString();
            }
            else {
                const parsed = new Date(current.nextVoteAt);
                dateText = Number.isNaN(parsed.getTime())
                    ? String(current.nextVoteAt)
                    : parsed.toLocaleDateString();
            }
            const descriptionLines = [];
            descriptionLines.push(dateText);
            descriptionLines.push("");
            descriptionLines.push("See current nominations: /noms");
            descriptionLines.push("Nominate a game: /gotm nominate or /nr-gotm nominate");
            const embed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle("Next Vote:")
                .setDescription(descriptionLines.join("\n"));
            await safeReply(interaction, {
                embeds: [embed],
                flags: ephemeral ? MessageFlags.Ephemeral : undefined,
            });
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            await safeReply(interaction, {
                content: `Error fetching next vote information: ${msg}`,
                flags: MessageFlags.Ephemeral,
            });
        }
    }
};
__decorate([
    Slash({
        description: "Show the date of the next GOTM/NR-GOTM vote",
        name: "nextvote",
    }),
    __param(0, SlashOption({
        description: "If true, show results in the channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], NextVoteCommand.prototype, "nextvote", null);
NextVoteCommand = __decorate([
    Discord()
], NextVoteCommand);
export { NextVoteCommand };
