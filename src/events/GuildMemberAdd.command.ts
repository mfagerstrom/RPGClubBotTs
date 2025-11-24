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
    const role: Role | undefined = member.guild.roles.cache.find(r=> r.name === "newcomers");
    if (role) {
        member.roles.add(role);
    }
  }
}