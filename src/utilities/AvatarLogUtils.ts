import axios from "axios";
import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import type { User } from "discord.js";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { formatTimestampWithDay, resolveLogChannel } from "./DiscordLogUtils.js";

type AvatarHistoryRecord = Awaited<ReturnType<typeof Member.getAvatarHistory>>[number];

async function downloadAvatarBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

function resolveAvatarImage(
  record: AvatarHistoryRecord | null | undefined,
  label: string,
  userId: string,
): { url: string | null; attachment: AttachmentBuilder | null } {
  if (!record) return { url: null, attachment: null };
  if (record.avatarBlob) {
    const name = `avatar-${label}-${userId}.png`;
    const attachment = new AttachmentBuilder(record.avatarBlob, { name });
    return { url: `attachment://${name}`, attachment };
  }
  if (record.avatarUrl) {
    return { url: record.avatarUrl, attachment: null };
  }
  return { url: null, attachment: null };
}

async function upsertAvatarRecord(
  user: User,
  avatarBlob: Buffer | null,
  opts?: { username?: string | null; globalName?: string | null },
): Promise<void> {
  const existing = await Member.getByUserId(user.id);
  const record: IMemberRecord = {
    userId: user.id,
    isBot: user.bot ? 1 : 0,
    username: opts?.username ?? user.username ?? existing?.username ?? null,
    globalName: opts?.globalName ?? user.globalName ?? existing?.globalName ?? null,
    avatarBlob,
    serverJoinedAt: existing?.serverJoinedAt ?? null,
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
}

export async function updateAvatarRecordFromUrl(
  user: User,
  avatarUrl: string,
): Promise<boolean> {
  const avatarBlob = await downloadAvatarBuffer(avatarUrl);
  if (!avatarBlob) return false;
  await upsertAvatarRecord(user, avatarBlob);
  return true;
}

export async function logAvatarChange(
  client: any,
  user: User,
  title: string,
): Promise<void> {
  const logChannel = await resolveLogChannel(client);
  if (!logChannel) return;

  const history = await Member.getAvatarHistory(user.id, 2);
  if (!history.length) return;

  const afterRecord = history[0];
  const beforeRecord = history[1] ?? null;
  const beforeImage = resolveAvatarImage(beforeRecord, "before", user.id);
  const afterImage = resolveAvatarImage(afterRecord, "after", user.id);

  if (!afterImage.url) return;

  const beforeLabel = beforeImage.url ? "" : "Unknown";
  const afterLabel = afterImage.url ? "" : "Unknown";
  const embed = new EmbedBuilder()
    .setAuthor({
      name: user.globalName ?? user.username,
      iconURL: user.displayAvatarURL(),
    })
    .setTitle(title)
    .setDescription(`**Before:** ${beforeLabel}\n**+After:** ${afterLabel}`)
    .setColor(0x3498db)
    .setFooter({
      text: `ID: ${user.id} • ${formatTimestampWithDay(afterRecord.changedAt.getTime())}`,
    })
    .setImage(afterImage.url);

  if (beforeImage.url) {
    embed.setThumbnail(beforeImage.url);
  }

  const files = [beforeImage.attachment, afterImage.attachment].filter(Boolean) as AttachmentBuilder[];
  await (logChannel as any).send({ embeds: [embed], files: files.length ? files : undefined });
}
