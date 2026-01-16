import { EmbedBuilder } from "discord.js";
import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "../utilities/DiscordLogUtils.js";
import { logAvatarChange, updateAvatarRecordFromUrl } from "../utilities/AvatarLogUtils.js";

@Discord()
export class GuildMemberUpdate {
  @On()
  async guildMemberUpdate(
    [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
    _client: Client,
  ): Promise<void> {
    void _client;

    const user = newMember.user;
    const oldNick = oldMember.nickname ?? oldMember.user.globalName ?? oldMember.user.username;
    const newNick = newMember.nickname ?? newMember.user.globalName ?? newMember.user.username;

    const nicknameChanged = oldNick !== newNick;
    const oldGuildAvatar = oldMember.avatar ?? null;
    const newGuildAvatar = newMember.avatar ?? null;
    const guildAvatarChanged = oldGuildAvatar !== newGuildAvatar;
    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));

    if (!user.bot && (addedRoles.size > 0 || removedRoles.size > 0)) {
      const logChannel = await resolveLogChannel(_client);
      if (logChannel) {
        const authorName = user.globalName ?? user.username;
        const timestamp = formatTimestampWithDay(Date.now());
        const sendRoleLog = async (
          label: string,
          roleId: string,
          color: number,
        ): Promise<void> => {
          if (roleId === newMember.guild.id) return;
          const embed = new EmbedBuilder()
            .setAuthor({
              name: authorName,
              iconURL: user.displayAvatarURL(),
            })
            .setTitle(label)
            .setDescription(`<@&${roleId}>`)
            .setColor(color)
            .setFooter({ text: `ID: ${user.id} • ${timestamp}` });
          await (logChannel as any).send({ embeds: [embed] });
        };

        for (const role of addedRoles.values()) {
          await sendRoleLog("Role added", role.id, 0x3498db);
        }

        for (const role of removedRoles.values()) {
          await sendRoleLog("Role removed", role.id, 0xe74c3c);
        }
      }
    }

    if (!user.bot && guildAvatarChanged) {
      const avatarUrl = newMember.displayAvatarURL({
        extension: "png",
        size: 512,
        forceStatic: true,
      });
      if (avatarUrl) {
        const updated = await updateAvatarRecordFromUrl(user, avatarUrl);
        if (updated) {
          await logAvatarChange(_client, user, "Server avatar changed");
        }
      }
    }

    if (!user.bot && nicknameChanged) {
      const logChannel = await resolveLogChannel(_client);
      if (logChannel) {
        const authorName = user.globalName ?? user.username;
        const timestamp = formatTimestampWithDay(Date.now());
        const sendNameLog = async (
          title: string,
          beforeValue: string,
          afterValue: string,
          color: number,
        ): Promise<void> => {
          const embed = new EmbedBuilder()
            .setAuthor({
              name: authorName,
              iconURL: user.displayAvatarURL(),
            })
            .setTitle(title)
            .setDescription(`**Before:** ${beforeValue}\n**+After:** ${afterValue}`)
            .setColor(color)
            .setFooter({ text: `ID: ${user.id} • ${timestamp}` });
          await (logChannel as any).send({ embeds: [embed] });
        };

        const oldNicknameValue =
          oldMember.nickname ?? oldMember.user.globalName ?? oldMember.user.username;
        const newNicknameValue =
          newMember.nickname ?? newMember.user.globalName ?? newMember.user.username;
        const nicknameTitle =
          oldMember.nickname && !newMember.nickname
            ? "Nickname removed"
            : !oldMember.nickname && newMember.nickname
            ? "Nickname added"
            : "Nickname changed";
        const nicknameColor =
          oldMember.nickname && !newMember.nickname ? 0xe74c3c : 0x3498db;
        await sendNameLog(
          nicknameTitle,
          oldNicknameValue,
          newNicknameValue,
          nicknameColor,
        );
      }
    }

    if (!nicknameChanged) {
      return;
    }

    try {
      const existing = await Member.getByUserId(user.id);
      const record: IMemberRecord = {
        userId: user.id,
        isBot: user.bot ? 1 : 0,
        username: user.username ?? existing?.username ?? null,
        globalName: newNick ?? existing?.globalName ?? null,
        avatarBlob: existing?.avatarBlob ?? null,
        serverJoinedAt: newMember.joinedAt ?? existing?.serverJoinedAt ?? null,
        serverLeftAt: existing?.serverLeftAt ?? null,
        lastSeenAt: existing?.lastSeenAt ?? null,
        roleAdmin: existing?.roleAdmin ?? 0,
        roleModerator: existing?.roleModerator ?? 0,
        roleRegular: existing?.roleRegular ?? 0,
        roleMember: existing?.roleMember ?? 0,
        roleNewcomer: existing?.roleNewcomer ?? 0,
        messageCount: existing?.messageCount ?? null,
        completionatorUrl: existing?.completionatorUrl ?? null,
        psnUsername: existing?.psnUsername ?? null,
        xblUsername: existing?.xblUsername ?? null,
        nswFriendCode: existing?.nswFriendCode ?? null,
        steamUrl: existing?.steamUrl ?? null,
        profileImage: existing?.profileImage ?? null,
        profileImageAt: existing?.profileImageAt ?? null,
      };

      await Member.upsert(record);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      console.error(`[GuildMemberUpdate] Failed to upsert nickname change for ${user.id}: ${msg}`);
    }
  }
}
