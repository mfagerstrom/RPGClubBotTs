import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";

const PUSH_PIN_EMOJI = "📌";

@Discord()
export class MessageReactionAdd {
  @On()
  async messageReactionAdd(
    [reaction, user]: ArgsOf<"messageReactionAdd">,
    _client: Client,
  ): Promise<void> {
    void _client;
    if (user.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }
      if (reaction.message?.partial) {
        await reaction.message.fetch();
      }
    } catch {
      return;
    }

    const emojiName = reaction.emoji?.name;
    if (emojiName !== PUSH_PIN_EMOJI && emojiName !== "pushpin") {
      return;
    }

    const message = reaction.message;
    if (!message || message.pinned || !message.guild) {
      return;
    }

    try {
      await message.pin();
    } catch (err: any) {
      const code = err?.code ?? err?.rawError?.code;
      const limitReached = code === 30003 || /maximum number of pins/i.test(err?.message ?? "");
      if (!limitReached) return;
      const channel: any = message.channel;
      if (channel && typeof channel.send === "function") {
        await channel.send({
          content: "Pin limit reached for this channel. Unpin something to pin this message.",
        }).catch(() => {});
      }
    }
  }
}
