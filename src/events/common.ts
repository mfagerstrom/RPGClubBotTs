import { Channel } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageDeleted {
  @On()
  messageDelete([message]: ArgsOf<"messageDelete">, client: Client): void {
    const userName: string | undefined =
      message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;
    console.log("Message Deleted", userName, message.content);
  }
}

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

    // channel name
    const channelId: string = message.channelId;
    const channel = await client.channels.fetch(channelId);
    // @ts-ignore
    consoleOutputString += `${channel.name}]: `;

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
  }
}
