var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { EmbedBuilder } from "discord.js";
import { searchHltb } from "../functions/SearchHltb.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let hltb = class hltb {
    async hltb(title, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        try {
            const result = await searchHltb(title);
            await outputHltbResultsAsEmbed(interaction, result, title, { ephemeral });
        }
        catch {
            await safeReply(interaction, {
                content: `Sorry, there was an error searching for "${title}". Please try again later.`,
                ephemeral,
            });
        }
    }
};
__decorate([
    Slash({ description: "How Long to Beat™ Search" }),
    __param(0, SlashOption({
        description: "Enter game title and optional descriptors (we're googling!)",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "If set to true, show the results in the channel instead of ephemerally.",
        name: "showinchat",
        required: false,
        type: ApplicationCommandOptionType.Boolean,
    }))
], hltb.prototype, "hltb", null);
hltb = __decorate([
    Discord()
], hltb);
export { hltb };
async function outputHltbResultsAsEmbed(interaction, result, hltbQuery, options) {
    if (result) {
        const hltb_result = result;
        const fields = [];
        if (hltb_result.singlePlayer) {
            fields.push({
                name: 'Single-Player',
                value: hltb_result.singlePlayer,
                inline: true,
            });
        }
        if (hltb_result.coOp) {
            fields.push({
                name: 'Co-Op',
                value: hltb_result.coOp,
                inline: true,
            });
        }
        if (hltb_result.vs) {
            fields.push({
                name: 'Vs.',
                value: hltb_result.vs,
                inline: true,
            });
        }
        if (hltb_result.main) {
            fields.push({
                name: 'Main',
                value: hltb_result.main,
                inline: true,
            });
        }
        if (hltb_result.mainSides) {
            fields.push({
                name: 'Main + Sides',
                value: hltb_result.mainSides,
                inline: true,
            });
        }
        if (hltb_result.completionist) {
            fields.push({
                name: 'Completionist',
                value: hltb_result.completionist,
                inline: true,
            });
        }
        const hltbEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`How Long to Beat ${hltb_result.name}`)
            .setURL(`https://howlongtobeat.com/game/${hltb_result.id}`)
            .setAuthor({
            name: 'HowLongToBeat™',
            iconURL: 'https://howlongtobeat.com/img/hltb_brand.png',
            url: 'https://howlongtobeat.com',
        })
            .setFields(fields)
            .setImage(hltb_result.imageUrl);
        await safeReply(interaction, { embeds: [hltbEmbed], ephemeral: options.ephemeral });
    }
    else {
        await safeReply(interaction, {
            content: `Sorry, no results were found for "${hltbQuery}"`,
            ephemeral: options.ephemeral,
        });
    }
}
