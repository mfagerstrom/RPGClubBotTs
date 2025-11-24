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
import { searchHltb } from "../functions/SearchHltb.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let Coverart = class Coverart {
    async coverart(title, showInChat, interaction) {
        const ephemeral = !showInChat;
        await safeDeferReply(interaction, { ephemeral });
        try {
            const result = await searchHltb(title);
            if (result && result.imageUrl) {
                await safeReply(interaction, {
                    content: result.imageUrl,
                    ephemeral,
                });
            }
            else {
                await safeReply(interaction, {
                    content: `Sorry, no cover art was found for "${title}".`,
                    ephemeral,
                });
            }
        }
        catch {
            await safeReply(interaction, {
                content: `Sorry, there was an error searching for cover art for "${title}". Please try again later.`,
                ephemeral,
            });
        }
    }
};
__decorate([
    Slash({ description: "Video Game Cover Art search, courtesy of Google and HLTB" }),
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
], Coverart.prototype, "coverart", null);
Coverart = __decorate([
    Discord()
], Coverart);
export { Coverart };
