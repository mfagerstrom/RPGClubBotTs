import type { Activity, CommandInteraction, GuildMember, User } from "discord.js";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  MessageFlags,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";
import {
  type ActivityIconPreference,
  ActivityEmojiError,
  collectActivityIconCandidates,
  getOrCreateActivityEmojiAsset,
} from "../services/ActivityEmojiService.js";
import {
  safeDeferReply,
  safeReply,
  sanitizeOptionalInput,
} from "../functions/InteractionUtils.js";

const ICON_CHOICES = [
  { name: "Auto (prefer large)", value: "auto" },
  { name: "Large icon", value: "large" },
  { name: "Small icon", value: "small" },
] as const;
const SIZE_CHOICES = [
  { name: "128 x 128", value: 128 },
  { name: "256 x 256", value: 256 },
] as const;

function getErrorMessage(err: unknown): string {
  if (err instanceof ActivityEmojiError) {
    if (err.code === "icon-rate-limited") {
      return "The icon host rate limited this request. Please try again in a minute.";
    }
    if (err.code === "icon-not-accessible") {
      return "The icon is not accessible from this environment.";
    }
    if (err.code === "unsupported-format") {
      return "Unsupported icon format. Try another activity icon.";
    }
    if (err.code === "icon-too-large") {
      return "The icon is too large for a Discord custom emoji (max 256 KB).";
    }
    if (err.code === "icon-not-square") {
      return "The icon is not square, so it cannot be converted safely for emoji use.";
    }
    if (err.code === "icon-size-unsupported") {
      return "Could not normalize this icon to the selected size.";
    }
    return err.message;
  }

  if (err instanceof Error && err.name === "TimeoutError") {
    return "Timed out while downloading the icon.";
  }

  return "Failed to generate emoji from activity icon.";
}

function getPresenceActivities(member: GuildMember): readonly Activity[] {
  const activities = member.presence?.activities ?? [];
  return activities.filter((activity) => activity?.assets?.largeImage || activity?.assets?.smallImage);
}

@Discord()
export class ActivityEmojiCommand {
  @Slash({
    name: "activity-emoji",
    description: "Generate an emoji-ready icon from Discord Rich Presence activity data",
  })
  async activityEmoji(
    @SlashOption({
      name: "member",
      description: "Member whose Rich Presence activity icon should be used",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    memberUser: User,
    @SlashOption({
      name: "activity",
      description: "Exact activity name (optional when only one icon is available)",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    activityNameRaw: string | undefined,
    @SlashChoice(...ICON_CHOICES)
    @SlashOption({
      name: "icon",
      description: "Choose which activity icon to use",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    iconPreferenceRaw: ActivityIconPreference | undefined,
    @SlashChoice(...SIZE_CHOICES)
    @SlashOption({
      name: "size",
      description: "Target output size",
      required: false,
      type: ApplicationCommandOptionType.Number,
    })
    sizeRaw: number | undefined,
    @SlashOption({
      name: "showinchat",
      description: "If true, send output publicly instead of ephemerally",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const guildMember = interaction.guild?.members.cache.get(memberUser.id)
      ?? await interaction.guild?.members.fetch(memberUser.id).catch(() => null);
    if (!guildMember) {
      await safeReply(interaction, {
        content: "I could not find that member in this server.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const activityName = sanitizeOptionalInput(activityNameRaw, { preserveNewlines: false });
    const iconPreference = iconPreferenceRaw ?? "auto";
    const targetSize = sizeRaw === 256 ? 256 : 128;

    const activityIcons = collectActivityIconCandidates(getPresenceActivities(guildMember), {
      activityName,
      iconPreference,
      targetSize,
    });

    if (!activityIcons.length) {
      const hint = activityName
        ? `No activity icon found for "${activityName}" on ${guildMember.displayName}.`
        : `No Rich Presence icon found for ${guildMember.displayName}.`;
      await safeReply(interaction, {
        content: `${hint} Make sure they are actively playing a game with Activity Data assets.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    if (activityIcons.length > 1 && !activityName) {
      const options = activityIcons.slice(0, 10).map((item) => {
        return `- ${item.activityName} (${item.iconType})`;
      });
      await safeReply(interaction, {
        content:
          "Multiple activity icons are available. Re-run with `activity:<name>` to select one.\n" +
          options.join("\n"),
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const candidate = activityIcons[0];
    if (!candidate) {
      await safeReply(interaction, {
        content: "No valid activity icon candidate was found.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    try {
      const asset = await getOrCreateActivityEmojiAsset(candidate, targetSize);
      const duplicateNotes: string[] = [];
      if (asset.isDuplicateBySource) {
        duplicateNotes.push("Source already processed in this bot runtime.");
      }
      if (asset.isDuplicateByBytes) {
        duplicateNotes.push("Bytes match an existing generated asset.");
      }
      const duplicateText = duplicateNotes.length ? `\n${duplicateNotes.join(" ")}` : "";
      const attachment = new AttachmentBuilder(asset.bytes, { name: asset.fileName });
      await safeReply(interaction, {
        content:
          `Generated emoji asset: \`${asset.emojiName}\` ` +
          `(${asset.iconType} icon, ${asset.size}x${asset.size}, ${asset.mimeType}).` +
          duplicateText,
        files: [attachment],
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    } catch (err) {
      await safeReply(interaction, {
        content: getErrorMessage(err),
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
    }
  }
}
