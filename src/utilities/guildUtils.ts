import { GuildMember } from "discord.js";
import { Client } from "discordx";
import fs from 'fs';



let memberRoles: string[] = [];

export async function scanGuild(
  client: Client,
) {
  const guildId: string = '191941851757019136';
  const guild = await client.guilds.fetch(guildId);

  // get roles
  const roleIds = client.guilds.cache
    .map((guild) => guild.roles.cache.map((role) => (role.id)))[0];

  const roleIdsJSON = JSON.stringify(roleIds);
  fs.writeFile('./src/data/roleIds.json', roleIdsJSON, (err) => {
    if (err) {
      console.log('Error writing file:', err);
    }
  });

  // Get all members 
  await guild.members.fetch();
  const memberArray: GuildMember[] = [];

  guild.members.cache.each(member => {
    memberArray.push(member);
  });

  // grab just the data from the member array that we need
  const members: Member[] = [];
  let member: Member;

  for (let x: number = 0; x < memberArray.length; x++) {
    memberRoles = await getMemberRoles(memberArray[x], roleIds);

    member = {
      id: memberArray[x].id,
      joinedTimestamp: memberArray[x].joinedAt,
      partedTimestamp: null,
      nickname: memberArray[x].nickname,
      user: {
        username: memberArray[x].user.username,
        globalName: memberArray[x].user.globalName,
        avatar: memberArray[x].user.avatarURL(),
      },
      roleIds: memberRoles,
    };

    members.push(member);
  }

  const membersJSON = JSON.stringify(members);
  fs.writeFile('./src/data/members.json', membersJSON, (err) => {
    if (err) {
      console.log('Error writing file:', err);
    }
  });
}

async function getMemberRoles(
  member: GuildMember,
  roleIds: string[]
): Promise<string[]> {

  const memberRoles: string[] = [];

  roleIds.forEach(async (roleId) => {
    if (member.roles.cache.has(roleId)) {
      memberRoles.push(roleId);
    }
  });
  return memberRoles;
}

interface Member {
  id: string;
  joinedTimestamp: Date | null,
  partedTimestamp?: Date | null,
  nickname: string | null;
  user: User;
  roleIds: string[];
}

interface User {
  username: string;
  globalName: string | null;
  avatar: string | null;
}