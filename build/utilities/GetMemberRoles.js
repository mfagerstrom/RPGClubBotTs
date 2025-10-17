export async function getMemberRoles(member) {
    const memberRoles = [];
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
