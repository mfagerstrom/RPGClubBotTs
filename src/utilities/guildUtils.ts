import { GuildMember } from "discord.js";
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

  const roleIds = client.guilds.cache
    .map((guild) => guild.roles.cache.map((role) => (role.id)))[0];

  const roleIdsJSON = JSON.stringify(roleIds);
  fs.writeFile('./src/data/roleIds.json', roleIdsJSON, (err) => {
    if (err) {
      console.log('Error writing file:', err);
    }
  });

  let memberRoles: string[] = [];
  let memberIndex: number = 0;

  membersOutput.forEach(async (memberOutput) => {
    memberRoles = await getMemberRoles(memberOutput, roleIds);

    member = {
      id: memberOutput.id,
      joinedTimestamp: memberOutput.joinedAt,
      partedTimestamp: null,
      nickname: memberOutput.nickname,
      user: {
        username: memberOutput.user.username,
        globalName: memberOutput.user.globalName,
        avatar: memberOutput.user.avatarURL(),
      },
      roleIds: memberRoles
    };

    if (memberIndex++ === 0) {
      console.log(member);
    }

    members.push(member);
  });

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