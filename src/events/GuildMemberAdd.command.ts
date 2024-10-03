import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildMemberAdd {
  @On()
  async guildMemberAdd(
    [member]: ArgsOf<"guildMemberAdd">,
    client: Client,
  ): Promise<void> {

    // auto-role assignment on member join
    let role: Role | undefined = member.guild.roles.cache.find(r=> r.name === "newcomers");
    if (role) {
        member.roles.add(role);
    }

    // record member information on member join
    // TODO: Connect to database
    // TODO: Check if member already exists in members table
    // TODO: If this is a rejoin, update joinDate and remove partDate
    // TODO: If this is a new member, insert a record in members table
  }
}