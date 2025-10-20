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
let Coverart = class Coverart {
    async coverart(title, interaction) {
        const result = await searchHltb(title);
        await interaction.reply({
            content: result.imageUrl,
        });
    }
};
__decorate([
    Slash({ description: "Video Game Cover Art search, courtesy of Google and HLTB" }),
    __param(0, SlashOption({
        description: "Enter game title and optional descriptors (we're googling!)",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Coverart.prototype, "coverart", null);
Coverart = __decorate([
    Discord()
], Coverart);
export { Coverart };
