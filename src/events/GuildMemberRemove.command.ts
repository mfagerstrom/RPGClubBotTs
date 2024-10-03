import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildMemberRemove {
  @On()
  async guildMemberRemove(
    [member]: ArgsOf<"guildMemberRemove">,
    client: Client,
  ): Promise<void> {

    // record member part date when member leaves
    // TODO: Connect to database
    // TODO: Update members table with part date
  }
}