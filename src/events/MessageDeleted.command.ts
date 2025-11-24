import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

  @Discord()
  export class MessageDeleted {
    @On()
    messageDelete([_message]: ArgsOf<"messageDelete">, _client: Client): void {
      void _message;
      void _client;
      /* 
      const userName: string | undefined =
        message.member?.nickname?.length ? message.member?.nickname : message.member?.displayName;
    console.log("Message Deleted", userName, message.content);
    */
  }
}
