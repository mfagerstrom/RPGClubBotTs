var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, On } from "discordx";
import Member from "../classes/Member.js";
let GuildMemberUpdate = class GuildMemberUpdate {
    async guildMemberUpdate([oldMember, newMember], _client) {
        void _client;
        const user = newMember.user;
        const oldNick = oldMember.nickname ?? oldMember.user.globalName ?? oldMember.user.username;
        const newNick = newMember.nickname ?? newMember.user.globalName ?? newMember.user.username;
        // Exit early if no change in nickname/global display
        if (oldNick === newNick) {
            return;
        }
        try {
            const existing = await Member.getByUserId(user.id);
            const record = {
                userId: user.id,
                isBot: user.bot ? 1 : 0,
                username: user.username ?? existing?.username ?? null,
                globalName: newNick ?? existing?.globalName ?? null,
                avatarBlob: existing?.avatarBlob ?? null,
                serverJoinedAt: newMember.joinedAt ?? existing?.serverJoinedAt ?? null,
                serverLeftAt: existing?.serverLeftAt ?? null,
                lastSeenAt: existing?.lastSeenAt ?? null,
                roleAdmin: existing?.roleAdmin ?? 0,
                roleModerator: existing?.roleModerator ?? 0,
                roleRegular: existing?.roleRegular ?? 0,
                roleMember: existing?.roleMember ?? 0,
                roleNewcomer: existing?.roleNewcomer ?? 0,
                messageCount: existing?.messageCount ?? null,
                completionatorUrl: existing?.completionatorUrl ?? null,
                psnUsername: existing?.psnUsername ?? null,
                xblUsername: existing?.xblUsername ?? null,
                nswFriendCode: existing?.nswFriendCode ?? null,
                steamUrl: existing?.steamUrl ?? null,
                profileImage: existing?.profileImage ?? null,
                profileImageAt: existing?.profileImageAt ?? null,
            };
            await Member.upsert(record);
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            console.error(`[GuildMemberUpdate] Failed to upsert nickname change for ${user.id}: ${msg}`);
        }
    }
};
__decorate([
    On()
], GuildMemberUpdate.prototype, "guildMemberUpdate", null);
GuildMemberUpdate = __decorate([
    Discord()
], GuildMemberUpdate);
export { GuildMemberUpdate };
