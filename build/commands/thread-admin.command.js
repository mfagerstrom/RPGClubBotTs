var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { ApplicationCommandOptionType, MessageFlags, PermissionsBitField, } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { removeThreadGameLink, setThreadGameLink } from "../classes/Thread.js";
import { safeReply } from "../functions/InteractionUtils.js";
let ThreadAdminCommands = class ThreadAdminCommands {
    async link(threadId, gamedbGameId, interaction) {
        if (!this.hasManageThreads(interaction)) {
            await safeReply(interaction, {
                content: "You need Manage Threads permission to use this.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await setThreadGameLink(threadId, gamedbGameId);
        await safeReply(interaction, {
            flags: MessageFlags.Ephemeral,
        });
    }
    async unlink(threadId, gamedbGameId, interaction) {
        if (!this.hasManageThreads(interaction)) {
            await safeReply(interaction, {
                content: "You need Manage Threads permission to use this.",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        const removed = await removeThreadGameLink(threadId, gamedbGameId);
        const target = gamedbGameId ? `GameDB game ${gamedbGameId}` : "all GameDB links";
        const suffix = removed === 0 ? " (no matching links were found)." : ".";
        await safeReply(interaction, {
            content: `Unlinked ${target} from thread ${threadId}${suffix}`,
            flags: MessageFlags.Ephemeral,
        });
    }
    hasManageThreads(interaction) {
        const member = interaction.member;
        if (!member || typeof member.permissions === "string")
            return false;
        return member.permissions.has(PermissionsBitField.Flags.ManageThreads);
    }
};
__decorate([
    Slash({ description: "Link a thread to a GameDB game id", name: "link" }),
    __param(0, SlashOption({
        name: "thread_id",
        description: "Thread id to link",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        name: "gamedb_game_id",
        description: "GameDB game id",
        required: true,
        type: ApplicationCommandOptionType.Integer,
    }))
], ThreadAdminCommands.prototype, "link", null);
__decorate([
    Slash({ description: "Unlink a thread from a GameDB game id", name: "unlink" }),
    __param(0, SlashOption({
        name: "thread_id",
        description: "Thread id to unlink",
        required: true,
        type: ApplicationCommandOptionType.String,
    })),
    __param(1, SlashOption({
        name: "gamedb_game_id",
        description: "Specific GameDB game id to unlink (omit to remove all)",
        required: false,
        type: ApplicationCommandOptionType.Integer,
    }))
], ThreadAdminCommands.prototype, "unlink", null);
ThreadAdminCommands = __decorate([
    Discord(),
    SlashGroup({ description: "Thread admin commands", name: "thread" }),
    SlashGroup("thread")
], ThreadAdminCommands);
export { ThreadAdminCommands };
