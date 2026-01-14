import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  User,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashOption } from "discordx";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import Member from "../classes/Member.js";

const AVATAR_HISTORY_PAGE_SIZE = 10;

function formatTimestamp(date: Date): string {
  const seconds = Math.floor(date.getTime() / 1000);
  return `<t:${seconds}:F>`;
}

type AvatarHistoryPage = {
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
  totalPages: number;
  safePage: number;
  totalCount: number;
};

async function buildAvatarHistoryPage(
  target: User,
  page: number,
): Promise<AvatarHistoryPage | null> {
  const totalCount = await Member.countAvatarHistory(target.id);
  if (!totalCount) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / AVATAR_HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * AVATAR_HISTORY_PAGE_SIZE;
  const history = await Member.getAvatarHistory(
    target.id,
    AVATAR_HISTORY_PAGE_SIZE,
    offset,
  );
  if (!history.length) return null;

  const displayName = target.displayName ?? target.username ?? "User";
  const embeds: EmbedBuilder[] = [];
  const files: AttachmentBuilder[] = [];

  history.forEach((entry, idx) => {
    const number = offset + idx + 1;
    const embed = new EmbedBuilder()
      .setTitle(`${displayName} Avatar History`)
      .setDescription(`Updated: ${formatTimestamp(entry.changedAt)}`)
      .setFooter({ text: `Entry ${number} of ${totalCount}` });

    if (entry.avatarUrl) {
      embed.setImage(entry.avatarUrl);
    } else if (entry.avatarBlob) {
      const fileName = `avatar_${entry.eventId}_${number}.png`;
      files.push(new AttachmentBuilder(entry.avatarBlob, { name: fileName }));
      embed.setImage(`attachment://${fileName}`);
    } else {
      embed.addFields({ name: "Avatar", value: "No avatar image stored." });
    }

    if (entry.avatarHash) {
      embed.addFields({ name: "Avatar Hash", value: entry.avatarHash, inline: true });
    }

    embeds.push(embed);
  });

  return { embeds, files, totalPages, safePage, totalCount };
}

function buildPaginationRow(
  ownerId: string,
  targetId: string,
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> {
  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  const prevButton = new ButtonBuilder()
    .setCustomId(`avatar-history-page:${ownerId}:${targetId}:${page}:prev`)
    .setLabel("Previous")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(prevDisabled);
  const nextButton = new ButtonBuilder()
    .setCustomId(`avatar-history-page:${ownerId}:${targetId}:${page}:next`)
    .setLabel("Next")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(nextDisabled);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton);
}

@Discord()
export class AvatarHistoryCommand {
  @Slash({ description: "View a user's avatar history", name: "avatar-history" })
  async avatarHistory(
    @SlashOption({
      description: "Member to view; defaults to you.",
      name: "member",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    member: User | undefined,
    @SlashOption({
      description: "Show in chat (public) instead of ephemeral",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const target = member ?? interaction.user;
    const pageResult = await buildAvatarHistoryPage(target, 0);
    if (!pageResult) {
      await safeReply(interaction, {
        content: `No avatar history found for <@${target.id}>.`,
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const { embeds, files, totalPages, safePage } = pageResult;
    const components = shouldRenderPrevNextButtons(safePage <= 0, safePage >= totalPages - 1)
      ? [buildPaginationRow(interaction.user.id, target.id, safePage, totalPages)]
      : [];

    await safeReply(interaction, {
      embeds,
      files: files.length ? files : undefined,
      components: components.length ? components : undefined,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @ButtonComponent({ id: /^avatar-history-page:\d+:\d+:\d+:(prev|next)$/ })
  async handlePage(interaction: ButtonInteraction): Promise<void> {
    const [, ownerId, targetId, pageRaw, dir] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This avatar history list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;
    const delta = dir === "next" ? 1 : -1;
    const nextPage = Math.max(page + delta, 0);
    const target = await interaction.client.users.fetch(targetId).catch(() => interaction.user);
    const pageResult = await buildAvatarHistoryPage(target, nextPage);
    if (!pageResult) {
      await interaction.update({
        content: "No avatar history found.",
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    const { embeds, files, totalPages, safePage } = pageResult;
    const components = shouldRenderPrevNextButtons(safePage <= 0, safePage >= totalPages - 1)
      ? [buildPaginationRow(ownerId, targetId, safePage, totalPages)]
      : [];

    await interaction.update({
      embeds,
      files: files.length ? files : undefined,
      components,
    });
  }
}
