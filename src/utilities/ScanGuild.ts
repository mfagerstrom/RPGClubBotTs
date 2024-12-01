import { Client, GuildMember } from "discord.js";
import Role from '../models/Role.js';
import Member from '../models/Member.js';
import { connectToDatabase } from '../config/database.js';
import { getMemberRoles } from './GetMemberRoles.js';

export async function scanGuild(client: Client) {
    await connectToDatabase();

    const guildId: string = '191941851757019136';
    const guild = await client.guilds.fetch(guildId);

    // Get roles
    const rolesData = guild.roles.cache.map(role => ({
        roleId: role.id,
        roleName: role.name
      }));

    // Save roles to MongoDB
    await Role.insertMany(rolesData);

    // Get all members
    await guild.members.fetch();
    const memberArray: GuildMember[] = [];

    guild.members.cache.each(member => {
        memberArray.push(member);
    });

    // Grab just the data from the member array that we need
    const members: Member[] = [];
    let member: Member;

    for (let x: number = 0; x < memberArray.length; x++) {
        const memberRoles = await getMemberRoles(memberArray[x]);

        member = {
            id: memberArray[x].id,
            joinedTimestamp: memberArray[x].joinedAt,
            partedTimestamp: null,
            nickname: memberArray[x].nickname,
            user: {
                username: memberArray[x].user.username,
                globalName: memberArray[x].user.globalName || 'Unknown',
                avatar: memberArray[x].user.avatarURL(),
            },
            memberRoles: memberRoles,
        };

        members.push(member);
    }

    // Save members to MongoDB
    await Member.insertMany(members);

    console.log("Roles and members have been saved to MongoDB.");
}

interface Member {
    id: string;
    joinedTimestamp: Date | null;
    partedTimestamp?: Date | null;
    nickname: string | null;
    user: User;
    memberRoles: MemberRole[]; 
}

interface MemberRole {
    roleId: string;
    roleName: string;
}

interface User {
    username: string;
    globalName: string | null;
    avatar: string | null;
}