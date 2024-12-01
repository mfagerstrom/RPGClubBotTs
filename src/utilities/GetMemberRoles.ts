import { GuildMember } from "discord.js";

interface MemberRole {
  roleId: string;
  roleName: string;
}

export async function getMemberRoles(
  member: GuildMember
): Promise<MemberRole[]> {

  const memberRoles: MemberRole[] = [];

  await member.guild.roles.fetch();

  // Iterate over the member's roles and extract role ID and name
  member.roles.cache.forEach(role => {
    memberRoles.push({
      roleId: role.id,
      roleName: role.name
    });
  });

  return memberRoles;
}