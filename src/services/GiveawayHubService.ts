import type { Client, TextBasedChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { countAvailableGameKeys, listAvailableGameKeys } from "../classes/GameKey.js";

export const GIVEAWAY_HUB_CHANNEL_ID = "1461101188572254351";
const GIVEAWAY_HUB_SCAN_LIMIT = 50;

export const KEYS_PAGE_SIZE = 20;

type GiveawayHubPayload = {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
};

type EmbedField = { name: string; value: string };

export function buildKeyListEmbed(
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
    return `${number}. **${key.gameTitle}** (${key.platform})`;
  });

  if (!lines.length) {
    return embed.setDescription("No keys are available right now.");
  }

  const fields: { name: string; value: string }[] = [];
  let buffer = "";
  for (const line of lines) {
    const next = buffer ? `${buffer}\n${line}` : line;
    if (next.length > 1024) {
      if (buffer) {
        fields.push({ name: fields.length ? "\u200B" : "Keys", value: buffer });
      }
      buffer = line;
    } else {
      buffer = next;
    }
  }

  if (buffer) {
    fields.push({ name: fields.length ? "\u200B" : "Keys", value: buffer });
  }

  embed.addFields(fields);

  return embed;
}

function buildKeyListFields(lines: string[]): EmbedField[] {
  const fields: EmbedField[] = [];
  let buffer = "";
  for (const line of lines) {
    const next = buffer ? `${buffer}\n${line}` : line;
    if (next.length > 1024) {
      if (buffer) {
        fields.push({ name: fields.length ? "\u200B" : "Keys", value: buffer });
      }
      buffer = line;
    } else {
      buffer = next;
    }
  }

  if (buffer) {
    fields.push({ name: fields.length ? "\u200B" : "Keys", value: buffer });
  }

  return fields;
}

function buildGiveawayHubEmbeds(
  keys: Awaited<ReturnType<typeof listAvailableGameKeys>>,
): EmbedBuilder[] {
  if (!keys.length) {
    return [];
  }

  const lines = keys.map((key, idx) =>
    `${idx + 1}. **${key.gameTitle}** (${key.platform})`,
  );
  const fields = buildKeyListFields(lines);
  const embeds: EmbedBuilder[] = [];
  for (let i = 0; i < fields.length; i += 25) {
    const chunk = fields.slice(i, i + 25);
    const embed = new EmbedBuilder()
      .setTitle(i === 0 ? "Game Key Giveaway" : "Game Key Giveaway (continued)")
      .addFields(chunk);
    embeds.push(embed);
  }

  const footer = `Total keys: ${keys.length}`;
  embeds[embeds.length - 1]?.setFooter({ text: footer });
  return embeds;
}

export async function getAvailableKeysPage(page: number): Promise<{
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

export async function listAllAvailableKeys(): Promise<
  Awaited<ReturnType<typeof listAvailableGameKeys>>
> {
  const totalCount = await countAvailableGameKeys();
  if (!totalCount) {
    return [];
  }

  const keys: Awaited<ReturnType<typeof listAvailableGameKeys>> = [];
  for (let offset = 0; offset < totalCount; offset += KEYS_PAGE_SIZE) {
    const batch = await listAvailableGameKeys(offset, KEYS_PAGE_SIZE);
    keys.push(...batch);
  }

  return keys;
}

function buildGiveawayHubComponents(hasKeys: boolean): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  const claimButton = new ButtonBuilder()
    .setCustomId("giveaway-hub-claim:0")
    .setLabel("Claim a Game")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!hasKeys);
  const donateButton = new ButtonBuilder()
    .setCustomId("giveaway-hub-donate")
    .setLabel("Donate a Game")
    .setStyle(ButtonStyle.Success);

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      claimButton,
      donateButton,
    ),
  );

  return rows;
}

async function buildGiveawayHubPayload(page: number): Promise<GiveawayHubPayload> {
  void page;
  const keys = await listAllAvailableKeys();
  if (!keys.length) {
    return {
      content: "There are no available game keys right now.",
      embeds: [],
      components: buildGiveawayHubComponents(false),
    };
  }

  return {
    embeds: buildGiveawayHubEmbeds(keys),
    components: buildGiveawayHubComponents(true),
  };
}

async function deleteAllGiveawayHubMessages(
  channel: TextBasedChannel,
): Promise<void> {
  let fetched = await channel.messages.fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT }).catch(() => null);
  while (fetched && fetched.size) {
    for (const message of fetched.values()) {
      await message.delete().catch(() => {});
    }
    fetched = await channel.messages.fetch({ limit: GIVEAWAY_HUB_SCAN_LIMIT }).catch(() => null);
  }
}

export async function refreshGiveawayHubMessage(
  client: Client,
  page = 0,
  options?: { forceRecreate?: boolean },
): Promise<void> {
  if (!client.user) {
    return;
  }

  const channel = await client.channels
    .fetch(GIVEAWAY_HUB_CHANNEL_ID)
    .catch(() => null);
  const textChannel = channel?.isTextBased() ? channel : null;
  if (!textChannel) {
    return;
  }

  const payload = await buildGiveawayHubPayload(page);
  if (!("send" in textChannel)) {
    return;
  }

  const shouldRecreate = options?.forceRecreate ?? true;
  if (shouldRecreate) {
    await deleteAllGiveawayHubMessages(textChannel);
  }

  const embeds = payload.embeds ?? [];
  if (!embeds.length) {
    await textChannel.send({
      content: payload.content,
      embeds: [],
      components: payload.components ?? [],
    }).catch(() => {});
    return;
  }

  for (let i = 0; i < embeds.length; i += 10) {
    const batch = embeds.slice(i, i + 10);
    await textChannel.send({
      content: i === 0 ? payload.content : undefined,
      embeds: batch,
      components: i === 0 ? payload.components ?? [] : [],
    }).catch(() => {});
  }
}

export async function recreateGiveawayHubMessage(client: Client): Promise<void> {
  await refreshGiveawayHubMessage(client, 0, { forceRecreate: true });
}
