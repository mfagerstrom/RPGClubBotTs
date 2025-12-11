import { Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    _client: Client,
  ): Promise<void> {
    void _client;
    const userName: string | undefined =
      message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;

    const hasMemberRole: boolean = message.member!.roles.cache.some(role => role.name === 'members');
    if (!hasMemberRole) {
      const membersRole: Role | undefined = message.member!.guild.roles.cache.find(r => r.name === 'members');
      const newcomersRole: Role | undefined = message.member!.guild.roles.cache.find(r => r.name === 'newcomers');
      if (membersRole) {
        console.log(`Granting member role to ${userName}`);
        message.member!.roles.add(membersRole);
      }
      if (newcomersRole){
        console.log(`Removing newcomers role from ${userName}`);
        message.member!.roles.remove(newcomersRole);
      }
    }
  }
}
