import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  CommandInteraction,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import {
  ButtonComponent,
  Discord,
  SelectMenuComponent,
  Slash,
  SlashGroup,
  SlashOption,
} from "discordx";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../functions/PaginationUtils.js";
import {
  claimGameKey,
  countAvailableGameKeys,
  createGameKey,
  getGameKeyById,
  listAvailableGameKeys,
  revokeGameKey,
} from "../classes/GameKey.js";
import { isAdmin } from "./admin.command.js";

const KEYS_PAGE_SIZE = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_PLATFORM_LENGTH = 50;
const MAX_KEY_LENGTH = 200;
const MEMBER_ROLE_ID = "747520789003239530";
const GIVEAWAY_LOG_CHANNEL_ID = "1439333324547035428";

function buildKeyListEmbed(
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
  page: number,
  totalPages: number,
  totalCount: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle("Game Key Giveaway")
    .setDescription("Available keys:")
    .setFooter({ text: `Page ${page + 1}/${totalPages} • ${totalCount} total` });

  const lines = keys.map((key, idx) => {
    const number = page * KEYS_PAGE_SIZE + idx + 1;
    return `${number}. **${key.gameTitle}** — ${key.platform} — Donated by <@${key.donorUserId}>`;
  });

  embed.addFields({
    name: "Keys",
    value: lines.join("\n"),
  });

  return embed;
}

async function getAvailableKeysPage(page: number): Promise<{
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>;
  totalCount: number;
  totalPages: number;
  safePage: number;
}> {
  const totalCount = await countAvailableGameKeys();
  if (totalCount === 0) {
    return { keys: [], totalCount: 0, totalPages: 1, safePage: 0 };
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / KEYS_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * KEYS_PAGE_SIZE;
  const keys = await listAvailableGameKeys(offset, KEYS_PAGE_SIZE);
  return { keys, totalCount, totalPages, safePage };
}

async function logGiveawayClaim(
  channel: any,
  userId: string,
  keyTitle: string,
  platform: string,
  keyId: number,
): Promise<void> {
  const message =
    `<@${userId}> claimed **${keyTitle}** (${platform}) [Key ID: ${keyId}].`;
  if (channel && typeof channel.send === "function") {
    await channel.send({ content: message }).catch(() => {});
  }
  console.log(`[Giveaway] ${message}`);
}

function buildKeyListComponents(
  sessionId: string,
  ownerId: string,
  page: number,
  totalPages: number,
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
  if (keys.length) {
    const options = keys.map((key) => ({
      label: key.gameTitle.slice(0, 100),
      value: String(key.keyId),
      description: `${key.platform} • Donor ${key.donorUserId}`.slice(0, 95),
    }));
    const select = new StringSelectMenuBuilder()
      .setCustomId(`giveaway-claim:${sessionId}:${ownerId}:${page}`)
      .setPlaceholder("Claim a key...")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
  }

  const prevDisabled = page <= 0;
  const nextDisabled = page >= totalPages - 1;
  if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
    const prevButton = new ButtonBuilder()
      .setCustomId(`giveaway-page:${sessionId}:${ownerId}:${page}:prev`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const nextButton = new ButtonBuilder()
      .setCustomId(`giveaway-page:${sessionId}:${ownerId}:${page}:next`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prevButton, nextButton));
  }

  return rows;
}

@Discord()
@SlashGroup({ description: "Game key giveaways", name: "gamegiveaway" })
@SlashGroup("gamegiveaway")
export class GiveawayCommand {
  @Slash({ description: "List available donated game keys", name: "list" })
  async listKeys(
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

    const sessionId = `giveaway-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const { keys, totalCount, totalPages, safePage } = await getAvailableKeysPage(0);
    if (!totalCount || !keys.length) {
      await safeReply(interaction, {
        content: "There are no available game keys right now.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const embed = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
    const components = buildKeyListComponents(
      sessionId,
      interaction.user.id,
      safePage,
      totalPages,
      keys,
    );

    await safeReply(interaction, {
      embeds: [embed],
      components,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @Slash({ description: "Donate a game key to the giveaway pool", name: "donate" })
  async donateKey(
    @SlashOption({
      description: "Game title",
      name: "title",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    title: string,
    @SlashOption({
      description: "Digital platform (Steam, Epic, GOG, etc.)",
      name: "platform",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    platform: string,
    @SlashOption({
      description: "The key to give away",
      name: "key",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    keyValue: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const trimmedTitle = title.trim();
    const trimmedPlatform = platform.trim();
    const trimmedKey = keyValue.trim();

    if (!trimmedTitle || !trimmedPlatform || !trimmedKey) {
      await safeReply(interaction, {
        content: "Title, platform, and key are all required.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      await safeReply(interaction, {
        content: `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (trimmedPlatform.length > MAX_PLATFORM_LENGTH) {
      await safeReply(interaction, {
        content: `Platform must be ${MAX_PLATFORM_LENGTH} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (trimmedKey.length > MAX_KEY_LENGTH) {
      await safeReply(interaction, {
        content: `Key must be ${MAX_KEY_LENGTH} characters or fewer.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const created = await createGameKey(
      trimmedTitle,
      trimmedPlatform,
      trimmedKey,
      interaction.user.id,
    );

    await safeReply(interaction, {
      content:
        `Thanks! Added **${created.gameTitle}** (${created.platform}) to the giveaway pool ` +
        `(Key ID: ${created.keyId}).`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({ description: "Revoke a donated game key", name: "revoke" })
  async revokeKey(
    @SlashOption({
      description: "Key ID to revoke",
      name: "key_id",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    keyId: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    if (!Number.isInteger(keyId) || keyId <= 0) {
      await safeReply(interaction, {
        content: "Invalid key id.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = await getGameKeyById(keyId);
    if (!key) {
      await safeReply(interaction, {
        content: "No key found with that id.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isDonor = key.donorUserId === interaction.user.id;
    if (!isDonor) {
      const isAdminUser = await isAdmin(interaction);
      if (!isAdminUser) return;
    }

    const removed = await revokeGameKey(keyId);
    await safeReply(interaction, {
      content: removed
        ? `Removed **${key.gameTitle}** (${key.platform}) from the giveaway pool.`
        : "Could not remove that key.",
      flags: MessageFlags.Ephemeral,
    });
  }

  @ButtonComponent({ id: /^giveaway-page:[^:]+:\d+:\d+:(prev|next)$/ })
  async handlePage(interaction: ButtonInteraction): Promise<void> {
    const [, sessionId, ownerId, pageRaw, dir] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This giveaway list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;
    const delta = dir === "next" ? 1 : -1;
    const nextPage = Math.max(page + delta, 0);

    const { keys, totalCount, totalPages, safePage } = await getAvailableKeysPage(nextPage);
    if (!totalCount || !keys.length) {
      await safeUpdate(interaction, {
        content: "There are no available game keys right now.",
        embeds: [],
        components: [],
      });
      return;
    }

    const embed = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
    const components = buildKeyListComponents(
      sessionId,
      ownerId,
      safePage,
      totalPages,
      keys,
    );
    await safeUpdate(interaction, { embeds: [embed], components });
  }

  @SelectMenuComponent({ id: /^giveaway-claim:[^:]+:\d+:\d+$/ })
  async handleClaim(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, sessionId, ownerId, pageRaw] = interaction.customId.split(":");
    if (interaction.user.id !== ownerId) {
      await safeReply(interaction, {
        content: "This giveaway list isn't for you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member: any = interaction.member;
    const roleCache = member?.roles?.cache;
    if (!roleCache || !roleCache.has(MEMBER_ROLE_ID)) {
      await safeReply(interaction, {
        content: "Claiming keys requires the Member role.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const page = Number(pageRaw);
    if (Number.isNaN(page)) return;

    const keyId = Number(interaction.values?.[0]);
    if (!Number.isInteger(keyId) || keyId <= 0) {
      await safeReply(interaction, {
        content: "Invalid selection.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate().catch(() => {});

    const key = await getGameKeyById(keyId);
    if (!key || key.claimedByUserId) {
      await interaction.followUp({
        content: "That key is no longer available.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    } else {
      const claimed = await claimGameKey(keyId, interaction.user.id);
      if (!claimed) {
        await interaction.followUp({
          content: "That key is no longer available.",
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        const logChannel = await interaction.client.channels
          .fetch(GIVEAWAY_LOG_CHANNEL_ID)
          .catch(() => null);
        const textChannel = logChannel?.isTextBased() ? logChannel : null;
        await logGiveawayClaim(
          textChannel,
          interaction.user.id,
          key.gameTitle,
          key.platform,
          key.keyId,
        );
        await interaction.followUp({
          content:
            `You claimed **${key.gameTitle}** (${key.platform}).\n` +
            `Key: \`${key.keyValue}\``,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }

    const { keys, totalCount, totalPages, safePage } = await getAvailableKeysPage(page);
    if (!totalCount || !keys.length) {
      await interaction.editReply({
        content: "There are no available game keys right now.",
        embeds: [],
        components: [],
      }).catch(() => {});
      return;
    }

    const embed = buildKeyListEmbed(keys, safePage, totalPages, totalCount);
    const components = buildKeyListComponents(
      sessionId,
      ownerId,
      safePage,
      totalPages,
      keys,
    );
    await interaction.editReply({ embeds: [embed], components }).catch(() => {});
  }
}
