import {
  AttachmentBuilder,
  type CommandInteraction,
  ApplicationCommandOptionType,
  EmbedBuilder,
  type User,
} from "discord.js";
import { Discord, Slash, SlashOption } from "discordx";
import axios from "axios";
import Member, { type IMemberRecord } from "../classes/Member.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";

type ProfileField = {
  label: string;
  value: string;
  inline?: boolean;
};

function formatDate(value: Date | null): string {
  if (!value) return "Unknown";
  return value.toLocaleString();
}

function buildProfileFields(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
): ProfileField[] {
  if (!record) {
    return [];
  }

  const fields: ProfileField[] = [];

  const globalName = record.globalName ?? "Unknown";
  if (globalName !== "Unknown") {
    fields.push({ label: "Global Name", value: globalName, inline: true });
  }

  fields.push({ label: "Last Seen", value: formatDate(record.lastSeenAt), inline: true });
  fields.push({ label: "Joined Server", value: formatDate(record.serverJoinedAt), inline: true });

  fields.push({
    label: "Roles",
    value:
      [
        record.roleAdmin ? "Admin" : null,
        record.roleModerator ? "Moderator" : null,
        record.roleRegular ? "Regular" : null,
        record.roleMember ? "Member" : null,
        record.roleNewcomer ? "Newcomer" : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/, $/, "") || "None",
  });

  if (record.isBot) {
    fields.push({ label: "Bot", value: "Yes", inline: true });
  }

  return fields;
}

function buildAvatarAttachment(
  record: Awaited<ReturnType<typeof Member.getByUserId>>,
): AttachmentBuilder | null {
  if (!record?.avatarBlob) return null;
  return new AttachmentBuilder(record.avatarBlob, { name: "profile-avatar.png" });
}

function avatarBuffersDifferent(a: Buffer | null, b: Buffer | null): boolean {
  if (!a && !b) return false;
  if (!!a !== !!b) return true;
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  return !a.equals(b);
}

async function downloadAvatar(url: string): Promise<Buffer | null> {
  try {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
    return Buffer.from(resp.data);
  } catch {
    return null;
  }
}

@Discord()
export class ProfileCommand {
  @Slash({ description: "Show a member profile", name: "profile" })
  async profile(
    @SlashOption({
      description: "Member to view; leave blank to view your own profile.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const target = member ?? interaction.user;
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { ephemeral });

    try {
      let record = await Member.getByUserId(target.id);
      const avatarUrl = target.displayAvatarURL({
        extension: "png",
        size: 512,
        forceStatic: true,
      });

      if (avatarUrl) {
        const newAvatar = await downloadAvatar(avatarUrl);
        const baseRecord: IMemberRecord =
          record ??
          ({
            userId: target.id,
            isBot: target.bot ? 1 : 0,
            username: target.username ?? null,
            globalName: (target as any).globalName ?? null,
            avatarBlob: null,
            serverJoinedAt: null,
            lastSeenAt: null,
            roleAdmin: 0,
            roleModerator: 0,
            roleRegular: 0,
            roleMember: 0,
            roleNewcomer: 0,
            messageCount: null,
            completionatorUrl: null,
            psnUsername: null,
            xblUsername: null,
            nswFriendCode: null,
            steamUrl: null,
          } satisfies IMemberRecord);

        if (newAvatar && avatarBuffersDifferent(baseRecord.avatarBlob, newAvatar)) {
          record = {
            ...baseRecord,
            avatarBlob: newAvatar,
            username: target.username ?? baseRecord.username,
            globalName: (target as any).globalName ?? baseRecord.globalName,
            isBot: target.bot ? 1 : 0,
          };
          await Member.upsert(record);
        } else if (!record) {
          record = baseRecord;
        }
      }

      if (!record) {
        await safeReply(interaction, {
          content: `No profile data found for <@${target.id}>.`,
          ephemeral,
        });
        return;
      }

      const fields = buildProfileFields(record).map((f) => ({
        name: f.label,
        value: f.value,
        inline: f.inline ?? false,
      }));
      const embed = new EmbedBuilder()
        .setTitle("Member Profile")
        .setDescription(`<@${target.id}>`)
        .addFields(fields);

      const attachment = buildAvatarAttachment(record);
      if (attachment) {
        embed.setThumbnail("attachment://profile-avatar.png");
      } else if (target.displayAvatarURL()) {
        embed.setThumbnail(target.displayAvatarURL());
      }

      await safeReply(interaction, {
        embeds: [embed],
        files: attachment ? [attachment] : undefined,
        ephemeral,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading profile: ${msg}`,
        ephemeral,
      });
    }
  }
}
