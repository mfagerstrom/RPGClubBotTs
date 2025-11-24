var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Discord, On } from "discordx";
let GuildMemberUpdate = class GuildMemberUpdate {
    async guildMemberUpdate([oldMember, newMember], client) {
        // has the member's nickname changed?
        if (newMember.nickname && oldMember.nickname !== newMember.nickname) {
            // TODO: connect to db
            // TODO: check to see if old nickname exists in the member nicknames table, add it if not
            // TODO: update members table with new nickname
            // TODO: add the new nickname to the member nicknames table
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
/*

reference:

bot.on('guildMemberUpdate', (oldMember, newMember) => {
    if(newMember.nickname && oldMember.nickname !== newMember.nickname) {
        if(newMember.nickname === 'somethink') {
            newMember.setNickname('NickName')
        }
    }
 });
 */ 
