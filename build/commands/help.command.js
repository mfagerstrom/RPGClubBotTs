var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { EmbedBuilder } from "discord.js";
import { Discord, Slash } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let BotHelp = class BotHelp {
    async help(interaction) {
        await safeDeferReply(interaction);
        const embed = new EmbedBuilder()
            .setTitle("RPG Club Bot Help")
            .setDescription("Summary of available slash commands")
            .addFields({
            name: "/gotm",
            value: "Search Game of the Month (GOTM) data.\n" +
                "Syntax: /gotm [round:<integer>] [year:<integer>] [month:<string>] [title:<string>]\n" +
                "Notes: If round is provided, it takes precedence. year+month target a specific month. title searches by game title.",
        }, {
            name: "/hltb",
            value: "Search HowLongToBeat for game completion times.\n" +
                "Syntax: /hltb title:<string>\n" +
                "Parameters: title (required string) - game title and optional descriptors.",
        }, {
            name: "/coverart",
            value: "Search for video game cover art using Google/HLTB data.\n" +
                "Syntax: /coverart title:<string>\n" +
                "Parameters: title (required string) - game title and optional descriptors.",
        }, {
            name: "/admin ... (Admin only)",
            value: "Admin-only commands for managing bot presence and related features.\n" +
                "Use /admin help for a detailed list of admin subcommands, their syntax, and parameters.",
        }, {
            name: "/mod ... (Moderator or above)",
            value: "Moderator commands for managing bot presence and related features.\n" +
                "Use /mod help for a detailed list of moderator subcommands, their syntax, and parameters.",
        });
        await safeReply(interaction, {
            embeds: [embed],
        });
    }
};
__decorate([
    Slash({ description: "Show help for all bot commands", name: "help" })
], BotHelp.prototype, "help", null);
BotHelp = __decorate([
    Discord()
], BotHelp);
export { BotHelp };
