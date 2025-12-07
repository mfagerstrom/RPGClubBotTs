import type { ArgsOf, Client } from "discordx";
import { Discord, On } from "discordx";
import Member, { type IMemberRecord } from "../classes/Member.js";

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

    // Exit early if no change in nickname/global display
    if (oldNick === newNick) {
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
