import {
  ActionRowBuilder,
  CommandInteraction,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ApplicationCommandOptionType,
  MessageFlags,
} from "discord.js";
import { Discord, SelectMenuComponent, Slash, SlashOption } from "discordx";
import Member, { type IMemberPlatformRecord } from "../classes/Member.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildProfileViewPayload } from "./profile.command.js";

const MAX_OPTIONS = 25;
const GUILD_FETCH_CHUNK_SIZE = 100;

type PlatformFilters = {
  steam: boolean;
  xbl: boolean;
  psn: boolean;
  nsw: boolean;
};

function hasAnyPlatform(record: IMemberPlatformRecord, filters: PlatformFilters): boolean {
  if (filters.steam && record.steamUrl) return true;
  if (filters.xbl && record.xblUsername) return true;
  if (filters.psn && record.psnUsername) return true;
  if (filters.nsw && record.nswFriendCode) return true;
  return false;
}

function formatPlatforms(record: IMemberPlatformRecord, filters: PlatformFilters): string {
  const platforms: string[] = [];

  if (filters.steam && record.steamUrl) platforms.push("Steam");
  if (filters.xbl && record.xblUsername) platforms.push("Xbox Live");
  if (filters.psn && record.psnUsername) platforms.push("PSN");
  if (filters.nsw && record.nswFriendCode) platforms.push("Switch");

  return platforms.join(", ");
}

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function filterActiveGuildMembers(
  members: IMemberPlatformRecord[],
  guild: CommandInteraction["guild"],
): Promise<IMemberPlatformRecord[]> {
  if (!guild || members.length === 0) return members;

  const ids = members.map((member) => member.userId);
  const chunks = chunkIds(ids, GUILD_FETCH_CHUNK_SIZE);
  const present = new Set<string>();

  for (const chunk of chunks) {
    try {
      const fetched = await guild.members.fetch({ user: chunk });
      fetched.forEach((member) => present.add(member.id));
    } catch {
      // ignore fetch errors and fall back to cached entries
      chunk.forEach((id) => {
        if (guild.members.cache.has(id)) {
          present.add(id);
        }
      });
    }
  }

  return members.filter((member) => present.has(member.userId));
}

function buildSummaryEmbed(
  members: IMemberPlatformRecord[],
  filters: PlatformFilters,
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
  note?: string;
} {
  const lines = members.map((member, idx) => {
    const platforms = formatPlatforms(member, filters);
    return `${idx + 1}. <@${member.userId}> — ${platforms}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Member Multiplayer Info")
    .setDescription(lines.join("\n") || "No member platform data found.")
    .setFooter({
      text:
        "Want to list your multiplayer info? Use /profile edit\n\n" +
        "Select a member below to view a profile.",
    });
  const options = members.slice(0, MAX_OPTIONS).map((member) => {
    const name = member.globalName ?? member.username ?? "Unknown member";
    const platforms = formatPlatforms(member, filters) || "Platforms not listed";
    return {
      label: name.slice(0, 100),
      value: member.userId,
      description: platforms.slice(0, 100),
    };
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId("mpinfo-select")
    .setPlaceholder("Select a member to view their profile")
    .addOptions(options)
    .setMinValues(1)
    .setMaxValues(1);

  const components = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
  const note =
    members.length > MAX_OPTIONS
      ? `Dropdown shows the first ${MAX_OPTIONS} of ${members.length} members.`
      : undefined;

  return { embed, components, note };
}

@Discord()
export class MultiplayerInfoCommand {
  @Slash({ description: "Show members with multiplayer handles", name: "mp-info" })
  async mpInfo(
    @SlashOption({
      description: "If true, post in channel instead of ephemerally.",
      name: "showinchat",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    showInChat: boolean | undefined,
    @SlashOption({
      description: "Include Steam users.",
      name: "steam",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    steam: boolean | undefined,
    @SlashOption({
      description: "Include Xbox Live users.",
      name: "xbl",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    xbl: boolean | undefined,
    @SlashOption({
      description: "Include PlayStation Network users.",
      name: "psn",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    psn: boolean | undefined,
    @SlashOption({
      description: "Include Nintendo Switch users.",
      name: "switch",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    nsw: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    const anyExplicitTrue = [steam, xbl, psn, nsw].some((val) => val === true);
    const filters: PlatformFilters = anyExplicitTrue
      ? {
          steam: steam === true,
          xbl: xbl === true,
          psn: psn === true,
          nsw: nsw === true,
        }
      : {
          steam: steam ?? true,
          xbl: xbl ?? true,
          psn: psn ?? true,
          nsw: nsw ?? true,
        };
    const ephemeral = !showInChat;
    await safeDeferReply(interaction, { flags: ephemeral ? MessageFlags.Ephemeral : undefined });

    const anyIncluded = filters.steam || filters.xbl || filters.psn || filters.nsw;
    if (!anyIncluded) {
      await safeReply(interaction, {
        content: "Please enable at least one platform filter.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const members = await Member.getMembersWithPlatforms();
    const filtered = members.filter((member) => hasAnyPlatform(member, filters));
    const activeMembers = await filterActiveGuildMembers(filtered, interaction.guild);

    if (!activeMembers.length) {
      await safeReply(interaction, {
        content: "No members match the selected platforms.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }

    const { embed, components, note } = buildSummaryEmbed(activeMembers, filters);

    await safeReply(interaction, {
      content: note,
      embeds: [embed],
      components,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  @SelectMenuComponent({ id: "mpinfo-select" })
  async handleProfileSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const userId = interaction.values?.[0];
    if (!userId) {
      await safeReply(interaction, {
        content: "Could not determine which member to load.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    try {
      const user = await interaction.client.users.fetch(userId);
      const result = await buildProfileViewPayload(user, interaction.guildId ?? undefined);

      if (result.errorMessage) {
        await safeReply(interaction, {
          content: result.errorMessage,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!result.payload) {
        await safeReply(interaction, {
          content:
            result.notFoundMessage ?? `No profile data found for <@${userId}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const components = interaction.message.components ?? [];
      const content = interaction.message.content ?? null;
      await safeUpdate(interaction, {
        ...result.payload,
        components,
        content,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not load that profile: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
