import { Channel, Role } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageCreated {
  @On()
  async messageCreate(
    [message]: ArgsOf<"messageCreate">,
    client: Client,
  ): Promise<void> {
    let consoleOutputString: string = '';

    // time stamp
    const messageDateTime: Date = new Date(message.createdTimestamp);
    const messageDateTimeString: string = messageDateTime.toLocaleString();
    consoleOutputString += `${messageDateTimeString} `;

    // user name
    const userName: string | undefined =
      message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;
    consoleOutputString += `[${userName} => `;

    // channel name (for threads)
    if (message.channel.type === 11) {
      const parentId: string | null = message.channel.parentId;
      if (parentId) {
        const parent: Channel | null = await client.channels.fetch(parentId);
        // @ts-ignore
        consoleOutputString += `#${parent.name}/${message.channel.name}]: `;
      }
    }

    // channel name (for regular channels)
    if (message.channel.type === 0) {
      consoleOutputString += `#${message.channel.name}]: `;
    }

    // message text
    let messageContent = message.content;
    if (messageContent === '') {
      messageContent = '(no message)';
    }

    consoleOutputString += messageContent;

    // images
    let attachment;
    if (message.attachments.size) {
      for (let x: number = 0; x < message.attachments.size; x++) {
        attachment = message.attachments.at(x);
        if (attachment?.contentType?.includes('image')) {
          consoleOutputString += `\n{image embedded: '${attachment.proxyURL}'}`;
        }
      }
    }

    console.log(consoleOutputString);
    //console.log(message.channel);

    // does the user have the members role?
    const hasMemberRole: boolean = message.member!.roles.cache.some(role => role.name === 'members');
    if (!hasMemberRole) {
      const role: Role | undefined = message.member!.guild.roles.cache.find(r => r.name === 'members');
      if (role) {
        console.log(`Granting member role to ${userName}`);
        message.member!.roles.add(role);
      }
    }
  }
}
