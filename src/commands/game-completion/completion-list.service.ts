import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type CommandInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import Member from "../../classes/Member.js";
import Game from "../../classes/Game.js";
import { COMPLETION_PAGE_SIZE, formatDiscordTimestamp, formatTableDate } from "../profile.command.js";
import { formatPlatformDisplayName } from "../../functions/PlatformDisplay.js";
import { safeReply } from "../../functions/InteractionUtils.js";
import { shouldRenderPrevNextButtons } from "../../functions/PaginationUtils.js";

/**
 * Renders a leaderboard showing all members with completions, optionally filtered by game title
 */
export async function renderCompletionLeaderboard(
  interaction: CommandInteraction,
  ephemeral: boolean,
  query?: string,
): Promise<void> {
  const leaderboard = await Member.getCompletionLeaderboard(25, query);
  if (!leaderboard.length) {
    await safeReply(interaction, {
      content: query
        ? `No completions found matching "${query}".`
        : "No completions recorded yet.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  const lines = leaderboard.map((m, idx) => {
    const name = m.globalName ?? m.username ?? m.userId;
    const suffix = m.count === 1 ? "completion" : "completions";
    return `${idx + 1}. **${name}**: ${m.count} ${suffix}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Game Completion Leaderboard")
    .setDescription(lines.join("\n"));
  const trimmedQuery = query?.trim();
  if (trimmedQuery) {
    embed.setFooter({ text: `Filter: "${trimmedQuery}"` });
  }

  const options = leaderboard.map((m) => ({
    label: (m.globalName ?? m.username ?? m.userId).slice(0, 100),
    value: m.userId,
    description: `${m.count} ${m.count === 1 ? "completion" : "completions"}`,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`comp-leaderboard-select${trimmedQuery ? `:${trimmedQuery.slice(0, 50)}` : ""}`)
    .setPlaceholder("View completions for a member")
    .addOptions(options);

  await safeReply(interaction, {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  });
}

/**
 * Renders a paginated list of a user's game completions
 */
export async function renderCompletionPage(
  interaction:
    | CommandInteraction
    | ButtonInteraction
    | StringSelectMenuInteraction
    | ModalSubmitInteraction,
  userId: string,
  page: number,
  year: number | "unknown" | null,
  ephemeral: boolean,
  query?: string,
): Promise<void> {
  const user =
    interaction.user.id === userId
      ? interaction.user
      : await interaction.client.users.fetch(userId).catch(() => interaction.user);

  const result = await buildCompletionEmbed(userId, page, year, user, query);

  if (!result) {
    if (year === "unknown") {
      await safeReply(interaction as any, {
        content: "You have no recorded completions with unknown dates.",
        flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      });
      return;
    }
    await safeReply(interaction as any, {
      content: year
        ? `You have no recorded completions for ${year}.`
        : "You have no recorded completions yet.",
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
    });
    return;
  }

  const { embed, totalPages, safePage } = result;

  const yearPart = year == null ? "" : String(year);
  const queryPart = query ? `:${query.slice(0, 50)}` : "";
  const components: any[] = [];

  if (totalPages > 1) {
    const options = [];
    const maxOptions = 25;
    let startPage = 0;
    let endPage = totalPages - 1;

    if (totalPages > maxOptions) {
      const half = Math.floor(maxOptions / 2);
      startPage = Math.max(0, safePage - half);
      endPage = Math.min(totalPages - 1, startPage + maxOptions - 1);
      startPage = Math.max(0, endPage - maxOptions + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      options.push({
        label: `Page ${i + 1}`,
        value: String(i),
        default: i === safePage,
      });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(`comp-page-select:${userId}:${yearPart}:list${queryPart}`)
      .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
      .addOptions(options);

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));

    const prevDisabled = safePage <= 0;
    const nextDisabled = safePage >= totalPages - 1;

    const prev = new ButtonBuilder()
      .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const next = new ButtonBuilder()
      .setCustomId(`comp-list-page:${userId}:${yearPart}:${safePage}:next${queryPart}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
    }
  }

  await safeReply(interaction as any, {
    embeds: [embed],
    components,
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
  });
}

/**
 * Renders a paginated list of completions with selection menu for editing or deleting
 */
export async function renderSelectionPage(
  interaction: CommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
  userId: string,
  page: number,
  mode: "edit" | "delete",
  year: number | "unknown" | null = null,
  query?: string,
): Promise<void> {
  const user =
    interaction.user.id === userId
      ? interaction.user
      : await interaction.client.users.fetch(userId).catch(() => interaction.user);

  const result = await buildCompletionEmbed(userId, page, year, user, query);

  if (!result) {
    const msg =
      mode === "edit"
        ? "You have no completions to edit matching your filters."
        : "You have no completions to delete matching your filters.";
    if (interaction.isMessageComponent() && !interaction.deferred && !interaction.replied) {
      await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    } else {
      await safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  const { embed, totalPages, safePage, pageCompletions } = result;

  const selectOptions = pageCompletions.map((c) => ({
    label: c.title.slice(0, 100),
    value: String(c.completionId),
    description: `${c.completionType} (${c.completedAt ? formatDiscordTimestamp(c.completedAt) : "No date"})`.slice(
      0,
      100,
    ),
  }));

  const selectId = mode === "edit" ? "comp-edit-menu" : "comp-del-menu";
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${selectId}:${userId}`)
    .setPlaceholder(`Select a completion to ${mode}`)
    .addOptions(selectOptions);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const queryPart = query ? `:${query.slice(0, 50)}` : "";
  const components: any[] = [selectRow];

  if (totalPages > 1) {
    const options = [];
    const maxOptions = 25;
    let startPage = 0;
    let endPage = totalPages - 1;

    if (totalPages > maxOptions) {
      const half = Math.floor(maxOptions / 2);
      startPage = Math.max(0, safePage - half);
      endPage = Math.min(totalPages - 1, startPage + maxOptions - 1);
      startPage = Math.max(0, endPage - maxOptions + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      options.push({
        label: `Page ${i + 1}`,
        value: String(i),
        default: i === safePage,
      });
    }

    const yearPart = year == null ? "" : String(year);
    const pageSelect = new StringSelectMenuBuilder()
      .setCustomId(`comp-page-select:${userId}:${yearPart}:${mode}${queryPart}`)
      .setPlaceholder(`Page ${safePage + 1} of ${totalPages}`)
      .addOptions(options);

    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(pageSelect));

    const prevDisabled = safePage <= 0;
    const nextDisabled = safePage >= totalPages - 1;

    const prev = new ButtonBuilder()
      .setCustomId(`comp-${mode}-page:${userId}:${yearPart}:${safePage}:prev${queryPart}`)
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled);
    const next = new ButtonBuilder()
      .setCustomId(`comp-${mode}-page:${userId}:${yearPart}:${safePage}:next${queryPart}`)
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled);

    if (shouldRenderPrevNextButtons(prevDisabled, nextDisabled)) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next));
    }
  }

  if (interaction.isMessageComponent()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.update({ embeds: [embed], components });
    }
  } else {
    await safeReply(interaction, {
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Builds an embed showing a user's game completions with pagination support
 */
async function buildCompletionEmbed(
  userId: string,
  page: number,
  year: number | "unknown" | null,
  interactionUser: User,
  query?: string,
): Promise<{
  embed: EmbedBuilder;
  total: number;
  totalPages: number;
  safePage: number;
  pageCompletions: any[];
} | null> {
  const total = await Member.countCompletions(userId, year, query);
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / COMPLETION_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const offset = safePage * COMPLETION_PAGE_SIZE;

  const allCompletions = await Member.getCompletions({
    userId,
    limit: 1000,
    offset: 0,
    year,
    title: query,
  });
  const platforms = await Game.getAllPlatforms();
  const platformMap = new Map(
    platforms.map((platform) => [platform.id, platform.abbreviation ?? platform.name]),
  );

  allCompletions.sort((a, b) => {
    const yearA = a.completedAt ? a.completedAt.getFullYear() : null;
    const yearB = b.completedAt ? b.completedAt.getFullYear() : null;

    if (yearA == null && yearB == null) {
      return a.title.localeCompare(b.title);
    }
    if (yearA == null) return 1;
    if (yearB == null) return -1;
    if (yearA !== yearB) {
      return yearB - yearA;
    }

    const dateA = a.completedAt ? a.completedAt.getTime() : 0;
    const dateB = b.completedAt ? b.completedAt.getTime() : 0;
    return dateA - dateB;
  });

  if (!allCompletions.length) return null;

  const yearCounts: Record<string, number> = {};
  const yearIndices = new Map<number, number>();

  for (const c of allCompletions) {
    const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
    yearCounts[yr] = (yearCounts[yr] ?? 0) + 1;
    yearIndices.set(c.completionId, yearCounts[yr]);
  }

  const pageCompletions = allCompletions.slice(offset, offset + COMPLETION_PAGE_SIZE);
  const dateWidth = 10;
  const maxIndexLabelLength =
    String(Math.max(...pageCompletions.map((c) => yearIndices.get(c.completionId) ?? 0)))
      .length + 1;

  const grouped = pageCompletions.reduce<Record<string, string[]>>((acc, c) => {
    const yr = c.completedAt ? String(c.completedAt.getFullYear()) : "Unknown";
    acc[yr] = acc[yr] || [];

    const yearIdx = yearIndices.get(c.completionId)!;
    const idxLabelRaw = `${yearIdx}.`;
    const idxLabel = idxLabelRaw.padStart(maxIndexLabelLength, " ");
    const dateLabel = c.completedAt
      ? formatTableDate(c.completedAt).padStart(dateWidth, " ")
      : "";

    const typeAbbrev =
      c.completionType === "Main Story"
        ? "M"
        : c.completionType === "Main Story + Side Content"
          ? "M+S"
          : "C";

    const idxBlock = `\`${idxLabel}\``;
    const dateBlock = dateLabel ? `\`${dateLabel}\`` : "";
    const rawPlatformName = c.platformId == null
      ? null
      : platformMap.get(c.platformId) ?? "Unknown Platform";
    const platformName = formatPlatformDisplayName(rawPlatformName);
    const platformLabel = platformName ? ` [${platformName}]` : "";
    const line = `${idxBlock} ${dateBlock} **${c.title}**${platformLabel} (${typeAbbrev})`
      .replace(
        /\s{2,}/g,
        " ",
      );
    acc[yr].push(line);
    if (c.note) {
      acc[yr].push(`> ${c.note}`);
    }
    return acc;
  }, {});

  const authorName = interactionUser.displayName ?? interactionUser.username ?? "User";
  const authorIcon = interactionUser.displayAvatarURL?.({
    size: 64,
    forceStatic: false,
  });
  const embed = new EmbedBuilder().setTitle(`${authorName}'s Completed Games (${total} total)`);
  const queryLabel = query?.trim();
  if (queryLabel) {
    embed.setDescription(`Filter: "${queryLabel}"`);
  }

  embed.setAuthor({
    name: authorName,
    iconURL: authorIcon ?? undefined,
  });

  const sortedYears = Object.keys(grouped).sort((a, b) => {
    if (a === "Unknown") return 1;
    if (b === "Unknown") return -1;
    return Number(b) - Number(a);
  });

  const addChunkedField = (yr: string, content: string, chunkIndex: number): void => {
    let name = "";
    if (chunkIndex === 0) {
      const count = yearCounts[yr] ?? 0;
      const displayYear = yr === "Unknown" ? "Unknown Date" : yr;
      name = `${displayYear} (${count})`;
    }
    embed.addFields({ name, value: content || "None", inline: false });
  };

  for (const yr of sortedYears) {
    const lines = grouped[yr];
    if (!lines || !lines.length) {
      addChunkedField(yr, "None", 0);
      continue;
    }

    let buffer = "";
    let chunkIndex = 0;
    const flush = (): void => {
      if (buffer) {
        addChunkedField(yr, buffer, chunkIndex);
        chunkIndex++;
        buffer = "";
      }
    };

    for (const line of lines) {
      const next = buffer ? `${buffer}\n${line}` : line;
      if (next.length > 1000) {
        flush();
        buffer = line;
      } else {
        buffer = next;
      }
    }
    flush();
  }

  const footerLines = ["M = Main Story • M+S = Main Story + Side Content • C = Completionist"];
  if (totalPages > 1) {
    footerLines.push(`${total} results. Page ${safePage + 1} of ${totalPages}.`);
  }
  embed.setFooter({ text: footerLines.join("\n") });

  return {
    embed,
    total,
    totalPages,
    safePage,
    pageCompletions,
  };
}
