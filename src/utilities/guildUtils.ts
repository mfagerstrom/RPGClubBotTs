import { Client } from "discordx";
import fs from 'fs';

const guildId: string = '191941851757019136';

export async function scanGuild(
  client: Client,
) {
  const guild = await client.guilds.fetch(guildId);
  const membersOutput = await guild.members.fetch();

  const members: Member[] = [];
  let member: Member;

  membersOutput.forEach(async (memberOutput) => {
    const guildRoles = memberOutput.roles.cache;

    member = {
      id: memberOutput.id,
      joinedTimestamp: memberOutput.joinedAt,
      partedTimestamp: null,
      nickname: memberOutput.nickname,
      user: {
        username: memberOutput.user.username,
        globalName: memberOutput.user.globalName,
        avatar: memberOutput.user.avatarURL(),
      }
    };
    members.push(member);
  });

  const membersJSON = JSON.stringify(members);
  fs.writeFile('./src/data/members.json', membersJSON, (err) => {
    if (err) {
      console.log('Error writing file:', err); 
    }
  });
}

interface Member {
  id: string;
  joinedTimestamp: Date | null,
  partedTimestamp?: Date | null,
  nickname: string | null;
  user: User;  
}

interface User {
  username: string;
  globalName: string | null;
  avatar: string | null;
}