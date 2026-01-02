var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, MessageFlags } from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { createSuggestion } from "../classes/Suggestion.js";
let SuggestionCommand = class SuggestionCommand {
    async suggestion(title, details, interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            await safeReply(interaction, {
                content: "Title cannot be empty.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const trimmedDetails = details?.trim();
        const suggestion = await createSuggestion(trimmedTitle, trimmedDetails ?? null, interaction.user.id);
        await safeReply(interaction, {
            content: `Thanks! Suggestion #${suggestion.suggestionId} submitted.`,
            flags: MessageFlags.Ephemeral,
        });
    }
};
__decorate([
    Slash({ description: "Submit a bot suggestion", name: "suggestion" }),
    __param(0, SlashOption({
        description: "Short suggestion title",
        name: "title",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        description: "Optional details for the suggestion",
        name: "details",
        required: false,
        type: ApplicationCommandOptionType.String,
    }))
], SuggestionCommand.prototype, "suggestion", null);
SuggestionCommand = __decorate([
    Discord()
], SuggestionCommand);
export { SuggestionCommand };
