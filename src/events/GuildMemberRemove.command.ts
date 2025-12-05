import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class GuildMemberRemove {
  @On()
  async guildMemberRemove(
    [_member]: ArgsOf<"guildMemberRemove">,
    _client: Client,
  ): Promise<void> {
    void _member;
    void _client;
  }
}
