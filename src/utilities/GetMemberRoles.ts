import { GuildMember } from "discord.js";

let memberRoles: string[] = [];

export async function getMemberRoles(
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
