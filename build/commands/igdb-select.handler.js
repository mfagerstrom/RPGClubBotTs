var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, SelectMenuComponent } from "discordx";
import { MessageFlags } from "discord.js";
import { handleIgdbSelectInteraction } from "../services/IgdbSelectService.js";
let IgdbSelectHandler = class IgdbSelectHandler {
    async handleIgdbSelect(interaction) {
        const handled = await handleIgdbSelectInteraction(interaction);
        if (!handled && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "This IGDB selection is no longer valid.", flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }
};
__decorate([
    SelectMenuComponent({ id: /^igdb-select:.+/ })
], IgdbSelectHandler.prototype, "handleIgdbSelect", null);
IgdbSelectHandler = __decorate([
    Discord()
], IgdbSelectHandler);
export { IgdbSelectHandler };
