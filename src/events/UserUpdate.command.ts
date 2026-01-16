import { EmbedBuilder } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { logAvatarChange, updateAvatarRecordFromUrl } from "../utilities/AvatarLogUtils.js";

@Discord()
export class UserUpdate {
  @On()
  async userUpdate([oldUser, newUser]: ArgsOf<"userUpdate">, client: Client): Promise<void> {
    if (newUser.bot) return;

    const oldUsername = oldUser.username ?? "Unknown";
    const newUsername = newUser.username ?? "Unknown";
    const oldGlobalName = oldUser.globalName ?? null;
    const newGlobalName = newUser.globalName ?? null;
    const oldAvatarHash = oldUser.avatar ?? null;
    const newAvatarHash = newUser.avatar ?? null;
    const avatarChanged = oldAvatarHash !== newAvatarHash;

    const usernameChanged = oldUsername !== newUsername;
    const globalNameChanged = oldGlobalName !== newGlobalName;

    if (avatarChanged) {
      const avatarUrl = newUser.displayAvatarURL({
        extension: "png",
        size: 512,
        forceStatic: true,
      });
      if (avatarUrl) {
        const updated = await updateAvatarRecordFromUrl(newUser, avatarUrl);
        if (updated) {
          await logAvatarChange(client, newUser, "Avatar changed");
        }
      }
    }

    if (!usernameChanged && !globalNameChanged) {
      return;
    }

    const logChannel = await resolveLogChannel(client);
    if (!logChannel) return;

    const authorName = newUser.globalName ?? newUser.username;
    const timestamp = formatTimestampWithDay(Date.now());

    const sendNameLog = async (
      title: string,
      beforeValue: string,
      afterValue: string,
    ): Promise<void> => {
      const embed = new EmbedBuilder()
        .setAuthor({
          name: authorName,
          iconURL: newUser.displayAvatarURL(),
        })
        .setTitle(title)
        .setDescription(`**Before:** ${beforeValue}\n**+After:** ${afterValue}`)
        .setColor(0x3498db)
        .setFooter({ text: `ID: ${newUser.id} • ${timestamp}` });
      await (logChannel as any).send({ embeds: [embed] });
    };

    if (usernameChanged) {
      await sendNameLog("Username changed", oldUsername, newUsername);
    }

    if (globalNameChanged) {
      const oldNameValue = oldGlobalName ?? oldUsername;
      const newNameValue = newGlobalName ?? newUsername;
      await sendNameLog("Display name changed", oldNameValue, newNameValue);
    }
  }
}
