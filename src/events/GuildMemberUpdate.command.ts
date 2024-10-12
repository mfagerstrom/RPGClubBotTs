import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildMemberUpdate {
    @On()
    async guildMemberUpdate(
        [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
        client: Client,
    ): Promise<void> {

        // has the member's nickname changed?
        if (newMember.nickname && oldMember.nickname !== newMember.nickname) {
            // TODO: connect to db
            // TODO: check to see if old nickname exists in the member nicknames table, add it if not
            // TODO: update members table with new nickname
            // TODO: add the new nickname to the member nicknames table
        }
    }
}

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