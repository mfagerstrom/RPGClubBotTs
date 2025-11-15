var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, PermissionsBitField } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
let Admin = class Admin {
    async presence(text, interaction) {
        await safeDeferReply(interaction);
        const okToUseCommand = await isAdmin(interaction);
        if (okToUseCommand) {
            await setPresence(interaction, text);
            await safeReply(interaction, {
                content: `I'm now playing: ${text}!`
            });
        }
    }
};
__decorate([
    Slash({ description: "Set Presence", name: "presence" }),
    __param(0, SlashOption({
        description: "What should the 'Now Playing' value be?",
        name: "text",
        required: true,
        type: ApplicationCommandOptionType.String,
    }))
], Admin.prototype, "presence", null);
Admin = __decorate([
    Discord(),
    SlashGroup({ description: "Admin Commands", name: "admin" }),
    SlashGroup("admin")
], Admin);
export { Admin };
export async function isAdmin(interaction) {
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);
    if (!isAdmin) {
        await safeReply(interaction, {
            content: 'Access denied.  Command requires Administrator role.'
        });
    }
    return isAdmin;
}
