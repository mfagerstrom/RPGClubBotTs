import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { ButtonInteraction, CommandInteraction, Message } from "discord.js";
import axios from "axios";
import {
  ButtonComponent,
  Discord,
  Slash,
  SlashGroup,
  SlashOption,
  SelectMenuComponent,
} from "discordx";
import {
  getPresenceHistory,
  setPresence,
  setPresenceFromInteraction,
  type IPresenceHistoryEntry,
} from "../functions/SetPresence.js";
import { AnyRepliable, safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import Gotm, {
  updateGotmGameFieldInDatabase,
} from "../classes/Gotm.js";
import NrGotm, {
  updateNrGotmGameFieldInDatabase,
} from "../classes/NrGotm.js";
import Member, { type IMemberRecord } from "../classes/Member.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import { getOraclePool } from "../db/oracleClient.js";
import Game, { type IGame } from "../classes/Game.js";
import { igdbService, type IGDBGame, type IGDBGameDetails } from "../services/IgdbService.js";
import { loadGotmFromDb } from "../classes/Gotm.js";
import { loadNrGotmFromDb } from "../classes/NrGotm.js";
import { setThreadGameLink } from "../classes/Thread.js";
import {
  createIgdbSession,
  deleteIgdbSession,
  type IgdbSelectOption,
} from "../services/IgdbSelectService.js";

type SuperAdminHelpTopicId =
  | "memberscan"
  | "gamedb-backfill"
  | "thread-game-link-backfill";

type SuperAdminHelpTopic = {
  id: SuperAdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

const SUPERADMIN_PRESENCE_CHOICES = new Map<string, string[]>();
const GAMEDB_SESSION_LIMIT: number = 10;

type GameDbSeed = {
  title: string;
  source: "GOTM" | "NR-GOTM";
  round: number;
  monthYear: string;
  gameIndex: number;
  gamedbGameId: number | null;
};

export const SUPERADMIN_HELP_TOPICS: SuperAdminHelpTopic[] = [
  {
    id: "memberscan",
    label: "/superadmin memberscan",
    summary: "Scan the server and refresh member records in the database.",
    syntax: "Syntax: /superadmin memberscan",
    notes: "Runs in the current server. Make sure env role IDs are set so roles classify correctly.",
  },
  {
    id: "gamedb-backfill",
    label: "/superadmin gamedb-backfill",
    summary: "Import all GOTM and NR-GOTM titles into GameDB with IGDB lookups.",
    syntax: "Syntax: /superadmin gamedb-backfill",
    notes: "Prompts if IGDB returns multiple matches; skips anything already in GameDB.",
  },
  {
    id: "thread-game-link-backfill",
    label: "/superadmin thread-game-link-backfill",
    summary: "Backfill thread-to-GameDB links using existing GOTM/NR-GOTM data.",
    syntax: "Syntax: /superadmin thread-game-link-backfill",
    notes: "Uses GOTM/NR-GOTM tables to set missing GameDB IDs on threads.",
  },
];

function buildSuperAdminHelpButtons(
  activeId?: SuperAdminHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("superadmin-help-select")
    .setPlaceholder("/superadmin help")
    .addOptions(
      SUPERADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

type ImageBufferResult = { buffer: Buffer; mimeType: string | null };

async function downloadImageBuffer(url: string): Promise<ImageBufferResult> {
  const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const mime = resp.headers?.["content-type"] ?? null;
  return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
}

export function buildSuperAdminHelpEmbed(topic: SuperAdminHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
  
  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
  }

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

async function showSuperAdminPresenceHistory(interaction: CommandInteraction): Promise<void> {
  const limit = 5;
  const entries = await getPresenceHistory(limit);

  if (!entries.length) {
    await safeReply(interaction, {
      content: "No presence history found.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = buildPresenceHistoryEmbed(entries as any);
  const components = buildSuperAdminPresenceButtons(entries.length);

  await safeReply(interaction, {
    embeds: [embed],
    components,
    ephemeral: true,
  });

  try {
    const msg = (await interaction.fetchReply()) as Message | undefined;
    if (msg?.id) {
      SUPERADMIN_PRESENCE_CHOICES.set(
        msg.id,
        entries.map((e: any) => e.activityName ?? ""),
      );
    }
  } catch {
    // ignore
  }
}

@Discord()
@SlashGroup({ description: "Server Owner Commands", name: "superadmin" })
@SlashGroup("superadmin")
export class SuperAdmin {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be? Leave empty to browse history.",
      name: "text",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    text: string | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);

    if (!okToUseCommand) return;

    if (text && text.trim()) {
      await setPresence(interaction, text.trim());
      await safeReply(interaction, {
        content: `I'm now playing: ${text.trim()}!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await showSuperAdminPresenceHistory(interaction);
  }

  @ButtonComponent({ id: /^superadmin-presence-restore-\d+$/ })
  async handleSuperAdminPresenceRestore(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    const entries = messageId ? SUPERADMIN_PRESENCE_CHOICES.get(messageId) : undefined;
    const idx = Number(interaction.customId.replace("superadmin-presence-restore-", ""));

    if (!entries || !Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
      await safeUpdate(interaction, {
        content: "Sorry, I couldn't find that presence entry. Please run `/superadmin presence` again.",
        components: [],
      });
      if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
      return;
    }

    const presenceText = entries[idx];

    try {
      await setPresenceFromInteraction(interaction, presenceText);
      await safeUpdate(interaction, {
        content: `Restored presence to: ${presenceText}`,
        components: [],
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeUpdate(interaction, {
        content: `Failed to restore presence: ${msg}`,
        components: [],
      });
    } finally {
      if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);
    }
  }

  @ButtonComponent({ id: "superadmin-presence-cancel" })
  async handleSuperAdminPresenceCancel(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    if (messageId) SUPERADMIN_PRESENCE_CHOICES.delete(messageId);

    await safeUpdate(interaction, {
      content: "No presence was restored.",
      components: [],
    });
  }

  @ButtonComponent({ id: /^(gotm|nr-gotm)-audit(img)?-(stop|skip|novalue).*-/ })
  async handleAuditButtons(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => {});
    }
  }

  @Slash({ description: "Scan guild members and upsert into RPG_CLUB_USERS", name: "memberscan" })
  async memberScan(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    const guild = interaction.guild;
    if (!guild) {
      await safeReply(interaction, { content: "This command must be run in a guild.", ephemeral: true });
      return;
    }

    const roleMap = {
      admin: process.env.ADMIN_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      mod: process.env.MODERATOR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      regular: process.env.REGULAR_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      member: process.env.MEMBER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
      newcomer: process.env.NEWCOMER_ROLE_ID?.replace(/[<@&>]/g, "").trim() || null,
    };

    await safeReply(interaction, { content: "Fetching all guild members... this may take a moment.", ephemeral: true });

    const members = await guild.members.fetch();
    const departedCount = await Member.markDepartedNotIn(Array.from(members.keys()));
    const pool = getOraclePool();
    let connection = await pool.getConnection();
    const isRecoverableOracleError = (err: any): boolean => {
      const code = err?.code ?? err?.errorNum;
      const msg = err?.message ?? "";
      return (
        code === "NJS-500" ||
        code === "NJS-503" ||
        code === "ORA-03138" ||
        code === "ORA-03146" ||
        /DPI-1010|ORA-03135|end-of-file on communication channel/i.test(msg)
      );
    };
    const reopenConnection = async () => {
      try {
        await connection?.close();
      } catch {
        // ignore
      }
      connection = await pool.getConnection();
    };

    let successCount = 0;
    let failCount = 0;

    const delay = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const avatarBuffersDifferent = (a: Buffer | null, b: Buffer | null): boolean => {
      if (!a && !b) return false;
      if (!!a !== !!b) return true;
      if (!a || !b) return true;
      if (a.length !== b.length) return true;
      return !a.equals(b);
    };

    try {
      for (const member of members.values()) {
        const user = member.user;
        const existing = await Member.getByUserId(user.id);

        // Build avatar blob (throttled per-user)
        let avatarBlob: Buffer | null = null;
        const avatarUrl = user.displayAvatarURL({ extension: "png", size: 512, forceStatic: true });
        if (avatarUrl) {
          try {
            const { buffer } = await downloadImageBuffer(avatarUrl);
            avatarBlob = buffer;
          } catch {
            // ignore avatar fetch failures
          }
        }

        const hasRole = (id?: string | null): number => {
          if (!id) return 0;
          return member.roles.cache.has(id) ? 1 : 0;
        };
        const adminFlag =
          hasRole(roleMap.admin) || member.permissions.has("Administrator") ? 1 : 0;
        const moderatorFlag =
          hasRole(roleMap.mod) || member.permissions.has("ManageMessages") ? 1 : 0;
        const regularFlag = hasRole(roleMap.regular);
        const memberFlag = hasRole(roleMap.member);
        const newcomerFlag = hasRole(roleMap.newcomer);

        const baseRecord: IMemberRecord = {
          userId: user.id,
          isBot: user.bot ? 1 : 0,
          username: user.username,
          globalName: (user as any).globalName ?? null,
          avatarBlob: null,
          serverJoinedAt: member.joinedAt ?? existing?.serverJoinedAt ?? null,
          serverLeftAt: null,
          lastSeenAt: existing?.lastSeenAt ?? null,
          roleAdmin: adminFlag,
          roleModerator: moderatorFlag,
          roleRegular: regularFlag,
          roleMember: memberFlag,
          roleNewcomer: newcomerFlag,
          messageCount: existing?.messageCount ?? null,
          completionatorUrl: existing?.completionatorUrl ?? null,
          psnUsername: existing?.psnUsername ?? null,
          xblUsername: existing?.xblUsername ?? null,
          nswFriendCode: existing?.nswFriendCode ?? null,
          steamUrl: existing?.steamUrl ?? null,
          profileImage: existing?.profileImage ?? null,
          profileImageAt: existing?.profileImageAt ?? null,
        };

        let avatarToUse: Buffer | null = avatarBlob;
        if (!avatarToUse && existing?.avatarBlob) {
          avatarToUse = existing.avatarBlob;
        } else if (avatarToUse && existing?.avatarBlob) {
          if (!avatarBuffersDifferent(avatarToUse, existing.avatarBlob)) {
            avatarToUse = existing.avatarBlob;
          }
        }

        const execUpsert = async (avatarData: Buffer | null) => {
          const record: IMemberRecord = { ...baseRecord, avatarBlob: avatarData };
          await Member.upsert(record, { connection });
        };

        try {
          await execUpsert(avatarToUse);
          successCount++;
        } catch (err) {
          const code = (err as any)?.code ?? (err as any)?.errorNum;

          if (code === "ORA-03146") {
            try {
              await execUpsert(null);
              successCount++;
              continue;
            } catch (retryErr) {
              failCount++;
              console.error(`Failed to upsert user ${user.id} after stripping avatar`, retryErr);
              continue;
            }
          }

          if (isRecoverableOracleError(err)) {
            await reopenConnection();
            try {
              await execUpsert(avatarBlob);
              successCount++;
              continue;
            } catch (retryErr) {
              failCount++;
              console.error(`Failed to upsert user ${user.id} after retry`, retryErr);
            }
          } else {
            failCount++;
            console.error(`Failed to upsert user ${user.id}`, err);
          }
        }

        // throttle: one user per second
        await delay(1000);

      }
    } finally {
      await connection.close();
    }

    await safeReply(interaction, {
      content:
        `Member scan complete. Upserts succeeded: ${successCount}. Failed: ${failCount}. ` +
        `Marked departed: ${departedCount}.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  @Slash({
    description: "Votes are typically held the last Friday of the month",
    name: "set-nextvote",
  })
  async setNextVote(
    @SlashOption({
      description:
        "Next vote date. Votes are typically held the last Friday of the month.",
      name: "date",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    dateText: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const parsed = new Date(dateText);
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
      await safeReply(interaction, {
        content:
          "Invalid date format. Please use a recognizable date such as `YYYY-MM-DD`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content:
            "No voting round information is available. Create a round before setting the next vote date.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await BotVotingInfo.updateNextVoteAt(current.roundNumber, parsed);

      await safeReply(interaction, {
        content:
          `Next vote date updated to ${parsed.toLocaleDateString()}. `,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating next vote date: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ description: "Show help for server owner commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildSuperAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      flags: MessageFlags.Ephemeral,
    });
  }

  @SelectMenuComponent({ id: "superadmin-help-select" })
  async handleSuperAdminHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as SuperAdminHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = topicId ? SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildSuperAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that superadmin help topic. Showing the superadmin help menu.",
      });
      return;
    }

    const helpEmbed = buildSuperAdminHelpEmbed(topic);
    const response = buildSuperAdminHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }

  @Slash({
    description: "Import GOTM and NR-GOTM titles into the GameDB (interactive IGDB search)",
    name: "gamedb-backfill",
  })
  async gamedbBackfill(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    try {
      await loadGotmFromDb();
      await loadNrGotmFromDb();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to load GOTM data: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const seeds = this.buildGamedbSeeds();
    const totalPending = seeds.length;
    const sessionSeeds = seeds.slice(0, GAMEDB_SESSION_LIMIT);
    if (!sessionSeeds.length) {
      await safeReply(interaction, {
        content: "No GOTM or NR-GOTM entries found to import.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const status = {
      total: sessionSeeds.length,
      processed: 0,
      logs: [] as string[],
      pendingTotal: totalPending,
    };

    const startMessage =
      `Starting GameDB backfill for ${sessionSeeds.length} of ${totalPending} pending titles ` +
      `(max ${GAMEDB_SESSION_LIMIT} per run)...`;

    const statusMessage = await safeReply(interaction, {
      content: startMessage,
      embeds: [this.buildGamedbStatusEmbed(startMessage, status.logs, false)],

      fetchReply: true,
    });

    for (const seed of sessionSeeds) {
      const label = `${seed.source} Round ${seed.round} (${seed.monthYear})`;
      try {
        const line = await this.processGamedbSeed(interaction, seed, label);
        if (line) status.logs.push(line);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        status.logs.push(`[${label}] Error: ${msg}`);
      }
      status.processed++;
      await this.editStatusMessage(interaction, statusMessage, status);
      await this.delay(400);
    }

    await this.editStatusMessage(interaction, statusMessage, status, true);
  }

  @Slash({
    description: "Backfill thread/game links from GOTM / NR-GOTM data",
    name: "thread-game-link-backfill",
  })
  async threadGameLinkBackfill(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    try {
      await loadGotmFromDb();
      await loadNrGotmFromDb();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to load GOTM/NR-GOTM data: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const assignments: { threadId: string; gamedbGameId: number; source: string }[] = [];

    Gotm.all().forEach((entry) => {
      entry.gameOfTheMonth.forEach((game) => {
        if (game.threadId && game.gamedbGameId) {
          assignments.push({ threadId: game.threadId, gamedbGameId: game.gamedbGameId, source: "GOTM" });
        }
      });
    });

    NrGotm.all().forEach((entry) => {
      entry.gameOfTheMonth.forEach((game) => {
        if (game.threadId && game.gamedbGameId) {
          assignments.push({ threadId: game.threadId, gamedbGameId: game.gamedbGameId, source: "NR-GOTM" });
        }
      });
    });

    if (!assignments.length) {
      await safeReply(interaction, {
        content: "No GOTM or NR-GOTM entries have both thread id and GameDB id set.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let success = 0;
    const failures: string[] = [];

    for (const a of assignments) {
      try {
        await setThreadGameLink(a.threadId, a.gamedbGameId);
        success++;
      } catch (err: any) {
        failures.push(`${a.source} thread ${a.threadId} -> game ${a.gamedbGameId}: ${err?.message ?? err}`);
      }
    }

    const lines: string[] = [`Updated ${success} thread link(s).`];
    if (failures.length) {
      lines.push("Failures:");
      lines.push(...failures.map((f) => `• ${f}`));
    }

    await safeReply(interaction, {
      content: lines.join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  }

  private buildGamedbSeeds(): GameDbSeed[] {
    const seeds: GameDbSeed[] = [];

    const gotmEntries = Gotm.all();
    gotmEntries.forEach((entry) => {
      entry.gameOfTheMonth.forEach((game, idx) => {
        if (game.gamedbGameId) return;
        if (!game.title) return;
        seeds.push({
          title: game.title,
          source: "GOTM",
          round: entry.round,
          monthYear: entry.monthYear,
          gameIndex: idx,
          gamedbGameId: game.gamedbGameId ?? null,
        });
      });
    });

    const nrEntries = NrGotm.all();
    nrEntries.forEach((entry) => {
      entry.gameOfTheMonth.forEach((game, idx) => {
        if (game.gamedbGameId) return;
        if (!game.title) return;
        seeds.push({
          title: game.title,
          source: "NR-GOTM",
          round: entry.round,
          monthYear: entry.monthYear,
          gameIndex: idx,
          gamedbGameId: game.gamedbGameId ?? null,
        });
      });
    });

    return seeds;
  }

  private async processGamedbSeed(
    interaction: CommandInteraction,
    seed: GameDbSeed,
    label: string,
  ): Promise<string | null> {
    if (seed.gamedbGameId) {
      return `[${label}] Skipped (already linked) ${seed.title}`;
    }

    const existingByTitle = await Game.searchGames(seed.title);
    const exactMatch = existingByTitle.find(
      (g) => g.title.toLowerCase() === seed.title.toLowerCase(),
    );
    if (exactMatch) {
      await this.linkGameToSeed(seed, exactMatch.id);
      return `[${label}] Linked existing GameDB #${exactMatch.id} to ${seed.title}`;
    }

    let igdbMatches: IGDBGame[] = [];
    try {
      const searchRes = await igdbService.searchGames(seed.title);
      igdbMatches = searchRes.results;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return `[${label}] IGDB search failed: ${msg}`;
    }

    if (!igdbMatches.length) {
      return `[${label}] No IGDB match for "${seed.title}"`;
    }

    const existingIgdb = await this.findExistingIgdbGame(igdbMatches);
    if (existingIgdb) {
      await this.linkGameToSeed(seed, existingIgdb.id);
      return `[${label}] Linked existing GameDB #${existingIgdb.id} to ${seed.title}`;
    }

    if (igdbMatches.length === 1) {
      return this.importGameFromIgdb(igdbMatches[0].id, label, seed);
    }

    const options: IgdbSelectOption[] = igdbMatches.map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      const rating = game.total_rating ? ` | ${Math.round(game.total_rating)}/100` : "";
      return {
        id: game.id,
        label: `${game.name} (${year})`.substring(0, 100),
        description: `${rating} ${game.summary ?? "No summary"}`.substring(0, 95),
      };
    });

    return await new Promise<string | null>((resolve) => {
      const { components, sessionId } = createIgdbSession(
        interaction.user.id,
        options,
        async (sel, igdbId) => {
          const result = await this.importGameFromIgdb(igdbId, label, seed);
          deleteIgdbSession(sessionId);
          finish(result);
          try {
            await sel.update({ content: result, components: [] });
          } catch {
            // ignore
          }
        },
      );

      const timeout = setTimeout(async () => {
        deleteIgdbSession(sessionId);
        finish(`[${label}] Skipped (no selection): ${seed.title}`);
        await safeReply(interaction, {
          content: `[${label}] Import cancelled or timed out.`,
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }, 120000);

      const finish = (value: string | null) => {
        clearTimeout(timeout);
        resolve(value);
      };

      safeReply(interaction, {
        content: `Multiple IGDB matches for ${seed.source} Round ${seed.round} (${seed.monthYear}).`,
        components,
  
        __forceFollowUp: true,
      });
    });
  }

  private async findExistingIgdbGame(matches: IGDBGame[]): Promise<IGame | null> {
    for (const match of matches) {
      const existing = await Game.getGameByIgdbId(match.id);
      if (existing) {
        return existing;
      }
    }
    return null;
  }

  private async importGameFromIgdb(igdbId: number, label: string, seed: GameDbSeed): Promise<string> {
    const details: IGDBGameDetails | null = await igdbService.getGameDetails(igdbId);
    if (!details) {
      return `[${label}] IGDB details unavailable for id ${igdbId}`;
    }

    const existing = details.id ? await Game.getGameByIgdbId(details.id) : null;
    if (existing) {
      return `[${label}] Skipped (IGDB already in GameDB #${existing.id}): ${details.name}`;
    }

    let imageData: Buffer | null = null;
    if (details.cover?.image_id) {
      try {
        const url =
          `https://images.igdb.com/igdb/image/upload/t_cover_big/${details.cover.image_id}.jpg`;
        const resp = await axios.get(url, { responseType: "arraybuffer" });
        imageData = Buffer.from(resp.data);
      } catch {
        // ignore image failures
      }
    }

    const igdbUrl =
      details.url || (details.slug ? `https://www.igdb.com/games/${details.slug}` : null);

    const newGame = await Game.createGame(
      details.name,
      details.summary ?? null,
      imageData,
      details.id,
      details.slug,
      details.total_rating ?? null,
      igdbUrl,
    );

    await Game.saveFullGameMetadata(newGame.id, details);
    await this.saveReleaseDates(newGame.id, details);
    await this.linkGameToSeed(seed, newGame.id);

    return `[${label}] Imported "${newGame.title}" -> GameDB #${newGame.id}`;
  }

  private async saveReleaseDates(gameId: number, details: IGDBGameDetails): Promise<void> {
    const releaseDates = details.release_dates;
    if (!releaseDates || !Array.isArray(releaseDates)) return;

    for (const release of releaseDates) {
      const platformId: number | null =
        typeof release.platform === "number"
          ? release.platform
          : (release.platform?.id ?? null);
      const platformName: string | null =
        typeof release.platform === "object"
          ? release.platform?.name ?? null
          : null;

      if (!platformId || !release.region) continue;

      const platform = await Game.ensurePlatform({ id: platformId, name: platformName });
      const region = await Game.ensureRegion(release.region);
      if (!platform || !region) continue;

      try {
        await Game.addReleaseInfo(
          gameId,
          platform.id,
          region.id,
          "Physical",
          release.date ? new Date(release.date * 1000) : null,
          null,
        );
      } catch {
        // ignore duplicate inserts
      }
    }
  }

  private chunkLines(lines: string[]): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const line of lines) {
      const addition = `${line}\n`;
      if ((current + addition).length > 1800) {
        chunks.push(current.trimEnd());
        current = addition;
      } else {
        current += addition;
      }
    }
    if (current.trim()) chunks.push(current.trimEnd());
    return chunks;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async editStatusMessage(
    interaction: CommandInteraction,
    message: any,
    status: { total: number; processed: number; logs: string[]; pendingTotal?: number },
    done: boolean = false,
  ): Promise<void> {
    const progress = status.pendingTotal
      ? `${status.processed}/${status.total} (of ${status.pendingTotal} pending)`
      : `${status.processed}/${status.total}`;
    const header = done
      ? `GameDB backfill complete. Processed ${progress}. Audit complete.`
      : `GameDB backfill in progress... (${progress})`;

    const embed = this.buildGamedbStatusEmbed(header, status.logs, done);

    try {
      if (message && typeof message.edit === "function") {
        await message.edit({ embeds: [embed] });
      } else {
        await safeReply(interaction, { embeds: [embed] });
      }
    } catch {
      // ignore status update failures
    }
  }

  private buildGamedbStatusEmbed(
    header: string,
    logs: string[],
    done: boolean,
  ): EmbedBuilder {
    const recentLogs = this.chunkLines(logs).slice(-1);
    const description = [header, ...recentLogs].join("\n\n").trim();

    return new EmbedBuilder()
      .setTitle("GameDB Backfill Audit")
      .setDescription(description)
      .setColor(done ? 0x2ecc71 : 0x3498db);
  }

  private async linkGameToSeed(seed: GameDbSeed, gameId: number): Promise<void> {
    if (seed.source === "GOTM") {
      await updateGotmGameFieldInDatabase(seed.round, seed.gameIndex, "gamedbGameId", gameId);
      Gotm.updateGamedbIdByRound(seed.round, gameId, seed.gameIndex);
    } else {
      await updateNrGotmGameFieldInDatabase({
        round: seed.round,
        gameIndex: seed.gameIndex,
        field: "gamedbGameId",
        value: gameId,
      });
      NrGotm.updateGamedbIdByRound(seed.round, gameId, seed.gameIndex);
    }
  }
}

export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";

export async function isSuperAdmin(interaction: AnyRepliable): Promise<boolean> {
  const anyInteraction = interaction as any;
  const guild = interaction.guild;
  const userId = interaction.user.id;

  if (!guild) {
    await safeReply(interaction, {
      content: "This command can only be used inside a server.",
    });
    return false;
  }

  const ownerId = guild.ownerId;
  const isOwner = ownerId === userId;

  if (!isOwner) {
    const denial = {
      content: "Access denied. Command is restricted to the server owner.",
      flags: MessageFlags.Ephemeral,
    };

    try {
      if (anyInteraction.replied || anyInteraction.deferred || anyInteraction.__rpgAcked) {
        await interaction.followUp(denial as any);
      } else {
        await interaction.reply(denial as any);
        anyInteraction.__rpgAcked = true;
        anyInteraction.__rpgDeferred = false;
      }
    } catch {
      // ignore
    }
  }

  return isOwner;
}
export function buildSuperAdminHelpResponse(
  activeTopicId?: SuperAdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Superadmin Commands Help")
    .setDescription(
      "Pick a `/superadmin` command to see what it does and how to run it (server owner only).",
    );

  const components = buildSuperAdminHelpButtons(activeTopicId);

  return {
    embeds: [embed],
    components,
  };
}

function buildPresenceHistoryEmbed(entries: IPresenceHistoryEntry[]): EmbedBuilder {
  const descriptionLines: string[] = entries.map((entry, index) => {
    const timestamp =
      entry.setAt instanceof Date
        ? entry.setAt.toLocaleString()
        : entry.setAt
          ? String(entry.setAt)
          : "unknown date";
    const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
    return `${index + 1}. ${entry.activityName} — ${timestamp} (by ${userDisplay})`;
  });

  descriptionLines.push("");
  descriptionLines.push("Would you like to restore a previous presence?");

  return new EmbedBuilder()
    .setTitle("Presence History")
    .setDescription(descriptionLines.join("\n"));
}

function buildSuperAdminPresenceButtons(count: number): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  for (let i = 0; i < count; i++) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`superadmin-presence-restore-${i}`)
        .setLabel(String(i + 1))
        .setStyle(ButtonStyle.Success),
    );
  }

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("superadmin-presence-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}
