import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
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
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, {
  type IGotmEntry,
  type IGotmGame,
  updateGotmGameFieldInDatabase,
  type GotmEditableField,
  insertGotmRoundInDatabase,
  deleteGotmRoundFromDatabase,
} from "../classes/Gotm.js";
import NrGotm, {
  type INrGotmEntry,
  type INrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmEditableField,
  insertNrGotmRoundInDatabase,
  deleteNrGotmRoundFromDatabase,
} from "../classes/NrGotm.js";
import Member, { type IMemberRecord } from "../classes/Member.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import {
  buildNominationDeleteViewEmbed,
  announceNominationChange,
} from "../functions/NominationAdminHelpers.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../classes/Nomination.js";
import { getOraclePool } from "../db/oracleClient.js";
import Game, { type IGame } from "../classes/Game.js";
import { igdbService, type IGDBGame, type IGDBGameDetails } from "../services/IgdbService.js";
import { loadGotmFromDb } from "../classes/Gotm.js";
import { loadNrGotmFromDb } from "../classes/NrGotm.js";

type SuperAdminHelpTopicId =
  | "presence"
  | "memberscan"
  | "add-gotm"
  | "edit-gotm"
  | "delete-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "delete-nr-gotm"
  | "delete-gotm-nomination"
  | "delete-nr-gotm-nomination"
  | "set-nextvote"
  | "gamedb-backfill";

type SuperAdminHelpTopic = {
  id: SuperAdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

const SUPERADMIN_PRESENCE_CHOICES = new Map<string, string[]>();
const GAMEDB_IMPORT_PROMPTS = new Map<string, (value: string | null) => void>();
const GAMEDB_SESSION_LIMIT: number = 10;

type GameDbSeed = {
  title: string;
  source: "GOTM" | "NR-GOTM";
  round: number;
  monthYear: string;
  gameIndex: number;
  gamedbGameId: number | null;
};

type IgdbSelectionResult = {
  selectedId: number | null;
  newQuery: string | null;
  skipped: boolean;
};

export const SUPERADMIN_HELP_TOPICS: SuperAdminHelpTopic[] = [
  {
    id: "presence",
    label: "/superadmin presence",
    summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
    syntax: "Syntax: /superadmin presence [text:<string>]",
    parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
  },
  {
    id: "memberscan",
    label: "/superadmin memberscan",
    summary: "Scan guild members and upsert them into RPG_CLUB_USERS.",
    syntax: "Syntax: /superadmin memberscan",
    notes: "Runs in the current guild; requires appropriate environment role IDs for classification.",
  },
  {
    id: "add-gotm",
    label: "/superadmin add-gotm",
    summary: "Interactively add a new GOTM round (requires GameDB ids).",
    syntax: "Syntax: /superadmin add-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest GOTM round.",
  },
  {
    id: "edit-gotm",
    label: "/superadmin edit-gotm",
    summary: "Interactively edit GOTM data for a given round (GameDB/thread/Reddit only).",
    syntax: "Syntax: /superadmin edit-gotm round:<integer>",
    parameters:
      "round (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "delete-gotm",
    label: "/superadmin delete-gotm",
    summary: "Delete the most recent GOTM round.",
    syntax: "Syntax: /superadmin delete-gotm",
    notes:
      "This removes the latest GOTM round from the database. Use this if a round was added too early or by mistake.",
  },
  {
    id: "add-nr-gotm",
    label: "/superadmin add-nr-gotm",
    summary: "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round (GameDB ids).",
    syntax: "Syntax: /superadmin add-nr-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
  },
  {
    id: "edit-nr-gotm",
    label: "/superadmin edit-nr-gotm",
    summary: "Interactively edit NR-GOTM data for a given round (GameDB/thread/Reddit only).",
    syntax: "Syntax: /superadmin edit-nr-gotm round:<integer>",
    parameters:
      "round (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "delete-nr-gotm",
    label: "/superadmin delete-nr-gotm",
    summary: "Delete the most recent NR-GOTM round.",
    syntax: "Syntax: /superadmin delete-nr-gotm",
    notes:
      "This removes the latest NR-GOTM round from the database. Use this if a round was added too early or by mistake.",
  },
  {
    id: "delete-gotm-nomination",
    label: "/superadmin delete-gotm-nomination",
    summary: "Delete any GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /superadmin delete-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "delete-nr-gotm-nomination",
    label: "/superadmin delete-nr-gotm-nomination",
    summary: "Delete any NR-GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /superadmin delete-nr-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "set-nextvote",
    label: "/superadmin set-nextvote",
    summary: "Set the date of the next GOTM/NR-GOTM vote.",
    syntax: "Syntax: /superadmin set-nextvote date:<date>",
    notes: "Votes are typically held the last Friday of the month.",
  },
  {
    id: "gamedb-backfill",
    label: "/superadmin gamedb-backfill",
    summary: "Import all GOTM and NR-GOTM titles into the GameDB using IGDB lookups.",
    syntax: "Syntax: /superadmin gamedb-backfill",
    notes: "Prompts for choice when IGDB returns multiple matches; skips titles already in GameDB.",
  },
];

function buildSuperAdminHelpButtons(
  activeId?: SuperAdminHelpTopicId,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(SUPERADMIN_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`superadmin-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  return rows;
}

type ImageBufferResult = { buffer: Buffer; mimeType: string | null };

async function downloadImageBuffer(url: string): Promise<ImageBufferResult> {
  const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer" });
  const mime = resp.headers?.["content-type"] ?? null;
  return { buffer: Buffer.from(resp.data), mimeType: mime ? String(mime) : null };
}

function extractSuperAdminTopicId(customId: string): SuperAdminHelpTopicId | null {
  const prefix = "superadmin-help-";
  const startIndex = customId.indexOf(prefix);
  if (startIndex === -1) return null;

  const raw = customId.slice(startIndex + prefix.length).trim();
  return (SUPERADMIN_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null) as
    | SuperAdminHelpTopicId
    | null;
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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function showSuperAdminPresenceHistory(interaction: CommandInteraction): Promise<void> {
  const limit = 5;
  const entries = await getPresenceHistory(limit);

  if (!entries.length) {
    await safeReply(interaction, {
      content: "No presence history found.",
      ephemeral: true,
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
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);

    if (!okToUseCommand) return;

    if (text && text.trim()) {
      await setPresence(interaction, text.trim());
      await safeReply(interaction, {
        content: `I'm now playing: ${text.trim()}!`,
        ephemeral: true,
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
    await safeDeferReply(interaction, { ephemeral: true });

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
      ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    try {
      const current = await BotVotingInfo.getCurrentRound();
      if (!current) {
        await safeReply(interaction, {
          content:
            "No voting round information is available. Create a round before setting the next vote date.",
          ephemeral: true,
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
        ephemeral: true,
      });
    }
  }

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: IGotmEntry[];
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading existing GOTM data: ${msg}`,
      });
      return;
    }

    const nextRound =
      allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

    await safeReply(interaction, {
      content: `Preparing to create GOTM round ${nextRound}.`,
    });

    const monthYearRaw = await promptUserForInput(
      interaction,
      `Enter the month/year label for round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
    );
    if (monthYearRaw === null) {
      return;
    }
    const monthYear = monthYearRaw.trim();
    if (!monthYear) {
      await safeReply(interaction, {
        content: "Month/year label cannot be empty. Creation cancelled.",
      });
      return;
    }

    const gameCountRaw = await promptUserForInput(
      interaction,
      "How many games are in this GOTM round? (1-5). Type `cancel` to abort.",
    );
    if (gameCountRaw === null) {
      return;
    }

    const gameCount = Number(gameCountRaw);
    if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
      await safeReply(interaction, {
        content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
      });
      return;
    }

    const games: IGotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const gamedbRaw = await promptUserForInput(
        interaction,
        `Enter the GameDB id for game #${n} (use /gamedb add first if needed).`,
      );
      if (gamedbRaw === null) {
        return;
      }
      const gamedbId = Number(gamedbRaw.trim());
      if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
        await safeReply(interaction, {
          content: "Invalid GameDB id. Creation cancelled.",
        });
        return;
      }
      const gameMeta = await Game.getGameById(gamedbId);
      if (!gameMeta) {
        await safeReply(interaction, {
          content: `GameDB id ${gamedbId} not found. Use /gamedb add first.`,
        });
        return;
      }

      const threadRaw = await promptUserForInput(
        interaction,
        `Enter the thread ID for game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (threadRaw === null) {
        return;
      }
      const threadTrimmed = threadRaw.trim();
      const threadId =
        threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;

      const redditRaw = await promptUserForInput(
        interaction,
        `Enter the Reddit URL for game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (redditRaw === null) {
        return;
      }
      const redditTrimmed = redditRaw.trim();
      const redditUrl =
        redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;

      games.push({
        title: gameMeta.title,
        threadId,
        redditUrl,
        gamedbGameId: gamedbId,
      });
    }

    try {
      await insertGotmRoundInDatabase(nextRound, monthYear, games);
      const newEntry = Gotm.addRound(nextRound, monthYear, games);
      const embedAssets = await buildGotmEntryEmbed(
        newEntry,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `Created GOTM round ${nextRound}.`,
        embeds: [embedAssets.embed],
        files: embedAssets.files?.length ? embedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create GOTM round ${nextRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
  async addNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: INrGotmEntry[];
    try {
      allEntries = NrGotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading existing NR-GOTM data: ${msg}`,
      });
      return;
    }

    const nextRound =
      allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

    await safeReply(interaction, {
      content: `Preparing to create NR-GOTM round ${nextRound}.`,
    });

    const monthYearRaw = await promptUserForInput(
      interaction,
      `Enter the month/year label for NR-GOTM round ${nextRound} (for example: "March 2024"). Type \`cancel\` to abort.`,
    );
    if (monthYearRaw === null) {
      return;
    }
    const monthYear = monthYearRaw.trim();
    if (!monthYear) {
      await safeReply(interaction, {
        content: "Month/year label cannot be empty. Creation cancelled.",
      });
      return;
    }

    const gameCountRaw = await promptUserForInput(
      interaction,
      "How many games are in this NR-GOTM round? (1-5). Type `cancel` to abort.",
    );
    if (gameCountRaw === null) {
      return;
    }

    const gameCount = Number(gameCountRaw);
    if (!Number.isInteger(gameCount) || gameCount < 1 || gameCount > 5) {
      await safeReply(interaction, {
        content: `Invalid game count "${gameCountRaw}". Creation cancelled.`,
      });
      return;
    }

    const games: INrGotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const gamedbRaw = await promptUserForInput(
        interaction,
        `Enter the GameDB id for NR-GOTM game #${n} (use /gamedb add first if needed).`,
      );
      if (gamedbRaw === null) {
        return;
      }
      const gamedbId = Number(gamedbRaw.trim());
      if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
        await safeReply(interaction, {
          content: "Invalid GameDB id. Creation cancelled.",
        });
        return;
      }
      const gameMeta = await Game.getGameById(gamedbId);
      if (!gameMeta) {
        await safeReply(interaction, {
          content: `GameDB id ${gamedbId} not found. Use /gamedb add first.`,
        });
        return;
      }

      const threadRaw = await promptUserForInput(
        interaction,
        `Enter the thread ID for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (threadRaw === null) {
        return;
      }
      const threadTrimmed = threadRaw.trim();
      const threadId =
        threadTrimmed && !/^none|null$/i.test(threadTrimmed) ? threadTrimmed : null;

      const redditRaw = await promptUserForInput(
        interaction,
        `Enter the Reddit URL for NR-GOTM game #${n} (or type \`none\` / \`null\` to leave blank).`,
      );
      if (redditRaw === null) {
        return;
      }
      const redditTrimmed = redditRaw.trim();
      const redditUrl =
        redditTrimmed && !/^none|null$/i.test(redditTrimmed) ? redditTrimmed : null;

      games.push({
        title: gameMeta.title,
        threadId,
        redditUrl,
        gamedbGameId: gamedbId,
      });
    }

    try {
      const insertedIds = await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
      const gamesWithIds = games.map((g, idx) => ({ ...g, id: insertedIds[idx] ?? null }));
      const newEntry = NrGotm.addRound(nextRound, monthYear, gamesWithIds);
      const embedAssets = await buildNrGotmEntryEmbed(
        newEntry,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `Created NR-GOTM round ${nextRound}.`,
        embeds: [embedAssets.embed],
        files: embedAssets.files?.length ? embedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create NR-GOTM round ${nextRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Edit GOTM data by round", name: "edit-gotm" })
  async editGotm(
    @SlashOption({
      description: "Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const roundNumber = Number(round);
    if (!Number.isFinite(roundNumber)) {
      await safeReply(interaction, {
        content: "Invalid round number.",
      });
      return;
    }

    let entries: IGotmEntry[];
    try {
      entries = Gotm.getByRound(roundNumber);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading GOTM data: ${msg}`,
      });
      return;
    }

    if (!entries.length) {
      await safeReply(interaction, {
        content: `No GOTM entry found for round ${roundNumber}.`,
      });
      return;
    }

    const entry = entries[0];

    const embedAssets = await buildGotmEntryEmbed(
      entry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Editing GOTM round ${roundNumber}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });

    const totalGames = entry.gameOfTheMonth.length;
    let gameIndex = 0;

    if (totalGames > 1) {
      const gameAnswer = await promptUserForInput(
        interaction,
        `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`,
      );
      if (gameAnswer === null) {
        return;
      }

      const idx = Number(gameAnswer);
      if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
        await safeReply(interaction, {
          content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
        });
        return;
      }
      gameIndex = idx - 1;
    }

    const fieldAnswerRaw = await promptUserForInput(
      interaction,
      "Which field do you want to edit? Type one of: `gamedb`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: GotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "gamedb") {
      field = "gamedbGameId";
    } else if (fieldAnswer === "thread") {
      field = "threadId";
      nullableField = true;
    } else if (fieldAnswer === "reddit") {
      field = "redditUrl";
      nullableField = true;
    } else {
      await safeReply(interaction, {
        content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
      });
      return;
    }

    const valuePrompt = nullableField
      ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
      : "Enter the new GameDB id.";

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | number | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    } else if (field === "gamedbGameId") {
      const parsed = Number(valueTrimmed);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        await safeReply(interaction, {
          content: "Please provide a valid numeric GameDB id.",
        });
        return;
      }
      const game = await Game.getGameById(parsed);
      if (!game) {
        await safeReply(interaction, {
          content: `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
        });
        return;
      }
      newValue = parsed;
    }

    try {
      await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field!, newValue);

      let updatedEntry: IGotmEntry | null = null;
      if (field === "gamedbGameId") {
        updatedEntry = Gotm.updateGamedbIdByRound(roundNumber, newValue as number, gameIndex);
      } else if (field === "threadId") {
        updatedEntry = Gotm.updateThreadIdByRound(roundNumber, newValue as string | null, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue as string | null, gameIndex);
      }

      const entryToShow = updatedEntry ?? entry;
      const updatedAssets = await buildGotmEntryEmbed(
        entryToShow,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `GOTM round ${roundNumber} updated successfully.`,
        embeds: [updatedAssets.embed],
        files: updatedAssets.files?.length ? updatedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to update GOTM round ${roundNumber}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Edit NR-GOTM data by round", name: "edit-nr-gotm" })
  async editNrGotm(
    @SlashOption({
      description: "NR-GOTM Round number to edit",
      name: "round",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    round: number,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const roundNumber = Number(round);
    if (!Number.isFinite(roundNumber)) {
      await safeReply(interaction, {
        content: "Invalid NR-GOTM round number.",
      });
      return;
    }

    let entries: INrGotmEntry[];
    try {
      entries = NrGotm.getByRound(roundNumber);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading NR-GOTM data: ${msg}`,
      });
      return;
    }

    if (!entries.length) {
      await safeReply(interaction, {
        content: `No NR-GOTM entry found for round ${roundNumber}.`,
      });
      return;
    }

    const entry = entries[0];

    const embedAssets = await buildNrGotmEntryEmbed(
      entry,
      interaction.guildId ?? undefined,
      interaction.client as any,
    );

    await safeReply(interaction, {
      content: `Editing NR-GOTM round ${roundNumber}.`,
      embeds: [embedAssets.embed],
      files: embedAssets.files?.length ? embedAssets.files : undefined,
    });

    const totalGames = entry.gameOfTheMonth.length;
    let gameIndex = 0;

    if (totalGames > 1) {
      const gameAnswer = await promptUserForInput(
        interaction,
        `Which game number (1-${totalGames}) do you want to edit? Type \`cancel\` to abort.`,
      );
      if (gameAnswer === null) {
        return;
      }

      const idx = Number(gameAnswer);
      if (!Number.isInteger(idx) || idx < 1 || idx > totalGames) {
        await safeReply(interaction, {
          content: `Invalid game number "${gameAnswer}". Edit cancelled.`,
        });
        return;
      }
      gameIndex = idx - 1;
    }

    const fieldAnswerRaw = await promptUserForInput(
      interaction,
      "Which field do you want to edit? Type one of: `gamedb`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: NrGotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "gamedb") {
      field = "gamedbGameId";
    } else if (fieldAnswer === "thread") {
      field = "threadId";
      nullableField = true;
    } else if (fieldAnswer === "reddit") {
      field = "redditUrl";
      nullableField = true;
    } else {
      await safeReply(interaction, {
        content: `Unknown field "${fieldAnswerRaw}". Edit cancelled.`,
      });
      return;
    }

    const valuePrompt = nullableField
      ? `Enter the new value for ${fieldAnswer} (or type \`none\` / \`null\` to clear it).`
      : "Enter the new GameDB id.";

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | number | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    } else if (field === "gamedbGameId") {
      const parsed = Number(valueTrimmed);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        await safeReply(interaction, {
          content: "Please provide a valid numeric GameDB id.",
        });
        return;
      }
      const game = await Game.getGameById(parsed);
      if (!game) {
        await safeReply(interaction, {
          content: `GameDB id ${parsed} was not found. Use /gamedb add first if needed.`,
        });
        return;
      }
      newValue = parsed;
    }

    try {
      await updateNrGotmGameFieldInDatabase({
        rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
        round: roundNumber,
        gameIndex,
        field: field!,
        value: newValue,
      });

      let updatedEntry: INrGotmEntry | null = null;
      if (field === "gamedbGameId") {
        updatedEntry = NrGotm.updateGamedbIdByRound(roundNumber, newValue as number, gameIndex);
      } else if (field === "threadId") {
        updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue as string | null, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue as string | null, gameIndex);
      }

      const entryToShow = updatedEntry ?? entry;
      const updatedAssets = await buildNrGotmEntryEmbed(
        entryToShow,
        interaction.guildId ?? undefined,
        interaction.client as any,
      );

      await safeReply(interaction, {
        content: `NR-GOTM round ${roundNumber} updated successfully.`,
        embeds: [updatedAssets.embed],
        files: updatedAssets.files?.length ? updatedAssets.files : undefined,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to update NR-GOTM round ${roundNumber}: ${msg}`,
      });
    }
  }

  @Slash({
    description: "Delete the most recent GOTM round",
    name: "delete-gotm",
  })
  async deleteGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: IGotmEntry[];
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading GOTM data: ${msg}`,
      });
      return;
    }

    if (!allEntries.length) {
      await safeReply(interaction, {
        content: "No GOTM rounds exist to delete.",
      });
      return;
    }

    const latestRound = Math.max(...allEntries.map((e) => e.round));
    const latestEntry = allEntries.find((e) => e.round === latestRound);

    if (!latestEntry) {
      await safeReply(interaction, {
        content: "Could not determine the most recent GOTM round to delete.",
      });
      return;
    }

    const summary = formatIGotmEntryForEdit(latestEntry);

    await safeReply(interaction, {
      content: [
        `You are about to delete GOTM round ${latestRound} (${latestEntry.monthYear}).`,
        "",
        "Current data:",
        "```",
        summary,
        "```",
      ].join("\n"),
    });

    const confirm = await promptUserForInput(
      interaction,
      `Type \`yes\` to confirm deletion of GOTM round ${latestRound}, or \`cancel\` to abort.`,
    );
    if (confirm === null) {
      return;
    }

    if (confirm.toLowerCase() !== "yes") {
      await safeReply(interaction, {
        content: "Delete cancelled.",
      });
      return;
    }

    try {
      const rowsDeleted = await deleteGotmRoundFromDatabase(latestRound);
      if (!rowsDeleted) {
        await safeReply(interaction, {
          content: `No database rows were deleted for GOTM round ${latestRound}. It may not exist in the database.`,
        });
        return;
      }

      Gotm.deleteRound(latestRound);

      await safeReply(interaction, {
        content: [
          `Deleted GOTM round ${latestRound} (${latestEntry.monthYear}).`,
          `Database rows deleted: ${rowsDeleted}.`,
          "",
          "Deleted data:",
          "```",
          summary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete GOTM round ${latestRound}: ${msg}`,
      });
    }
  }

  @Slash({
    description: "Delete the most recent NR-GOTM round",
    name: "delete-nr-gotm",
  })
  async deleteNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: INrGotmEntry[];
    try {
      allEntries = NrGotm.all();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error loading NR-GOTM data: ${msg}`,
      });
      return;
    }

    if (!allEntries.length) {
      await safeReply(interaction, {
        content: "No NR-GOTM rounds exist to delete.",
      });
      return;
    }

    const latestRound = Math.max(...allEntries.map((e) => e.round));
    const latestEntry = allEntries.find((e) => e.round === latestRound);

    if (!latestEntry) {
      await safeReply(interaction, {
        content: "Could not determine the most recent NR-GOTM round to delete.",
      });
      return;
    }

    const summary = formatIGotmEntryForEdit(latestEntry as any);

    await safeReply(interaction, {
      content: [
        `You are about to delete NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
        "",
        "Current data:",
        "```",
        summary,
        "```",
      ].join("\n"),
    });

    const confirm = await promptUserForInput(
      interaction,
      `Type \`yes\` to confirm deletion of NR-GOTM round ${latestRound}, or \`cancel\` to abort.`,
    );
    if (confirm === null) {
      return;
    }

    if (confirm.toLowerCase() !== "yes") {
      await safeReply(interaction, {
        content: "Delete cancelled.",
      });
      return;
    }

    try {
      const rowsDeleted = await deleteNrGotmRoundFromDatabase(latestRound);
      if (!rowsDeleted) {
        await safeReply(interaction, {
          content: `No database rows were deleted for NR-GOTM round ${latestRound}. It may not exist in the database.`,
        });
        return;
      }

      NrGotm.deleteRound(latestRound);

      await safeReply(interaction, {
        content: [
          `Deleted NR-GOTM round ${latestRound} (${latestEntry.monthYear}).`,
          `Database rows deleted: ${rowsDeleted}.`,
          "",
          "Deleted data:",
          "```",
          summary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete NR-GOTM round ${latestRound}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Show help for server owner commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildSuperAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      ephemeral: true,
    });
  }

  @ButtonComponent({ id: /^superadmin-help-.+/ })
  async handleSuperAdminHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = extractSuperAdminTopicId(interaction.customId);
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
    description: "Delete any GOTM nomination for the upcoming round",
    name: "delete-gotm-nomination",
  })
  async deleteGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: any,
    @SlashOption({
      description: "Reason for deletion (required)",
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      const targetRound = window.targetRound;
      const nomination = await getNominationForUser("gotm", targetRound, user.id);
      const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
      const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

      if (!nomination) {
        await safeReply(interaction, {
          content: `No GOTM nomination found for Round ${targetRound} by ${targetName}.`,
          ephemeral: true,
        });
        return;
      }

      await deleteNominationForUser("gotm", targetRound, user.id);
      const nominations = await listNominationsForRound("gotm", targetRound);
      const embed = buildNominationDeleteViewEmbed("GOTM", "/gotm nominate", targetRound, window, nominations);
      const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
      const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for GOTM Round ${targetRound}. Reason: ${reason}`;

      await interaction.deleteReply().catch(() => {});

      await announceNominationChange("gotm", interaction as any, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "Delete any NR-GOTM nomination for the upcoming round",
    name: "delete-nr-gotm-nomination",
  })
  async deleteNrGotmNomination(
    @SlashOption({
      description: "User whose nomination should be removed",
      name: "user",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    user: any,
    @SlashOption({
      description: "Reason for deletion (required)",
      name: "reason",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    reason: string,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Superadmin role.", ephemeral: true });
      return;
    }

    try {
      const window = await getUpcomingNominationWindow();
      const targetRound = window.targetRound;
      const nomination = await getNominationForUser("nr-gotm", targetRound, user.id);
      const targetUser = await interaction.client.users.fetch(user.id).catch(() => user);
      const targetName = targetUser?.tag ?? user.tag ?? user.username ?? user.id;

      if (!nomination) {
        await safeReply(interaction, {
          content: `No NR-GOTM nomination found for Round ${targetRound} by ${targetName}.`,
          ephemeral: true,
        });
        return;
      }

      await deleteNominationForUser("nr-gotm", targetRound, user.id);
      const nominations = await listNominationsForRound("nr-gotm", targetRound);
      const embed = buildNominationDeleteViewEmbed("NR-GOTM", "/nr-gotm nominate", targetRound, window, nominations);
      const adminName = interaction.user.tag ?? interaction.user.username ?? interaction.user.id;
      const content = `${adminName} deleted <@${user.id}>'s nomination "${nomination.gameTitle}" for NR-GOTM Round ${targetRound}. Reason: ${reason}`;

      await interaction.deleteReply().catch(() => {});

      await announceNominationChange("nr-gotm", interaction as any, content, embed);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to delete nomination: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "Import GOTM and NR-GOTM titles into the GameDB (interactive IGDB search)",
    name: "gamedb-backfill",
  })
  async gamedbBackfill(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isSuperAdmin(interaction);
    if (!okToUseCommand) return;

    try {
      await loadGotmFromDb();
      await loadNrGotmFromDb();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to load GOTM data: ${msg}`,
        ephemeral: true,
      });
      return;
    }

    const seeds = this.buildGamedbSeeds();
    const totalPending = seeds.length;
    const sessionSeeds = seeds.slice(0, GAMEDB_SESSION_LIMIT);
    if (!sessionSeeds.length) {
      await safeReply(interaction, {
        content: "No GOTM or NR-GOTM entries found to import.",
        ephemeral: true,
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
      ephemeral: false,
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

    let searchTerm = seed.title;

    while (true) {
      let igdbMatches: IGDBGame[] = [];
      try {
        const searchRes = await igdbService.searchGames(searchTerm, 8);
        igdbMatches = searchRes.results;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        return `[${label}] IGDB search failed: ${msg}`;
      }

      if (!igdbMatches.length) {
        return `[${label}] No IGDB match for "${searchTerm}"`;
      }

      const existingIgdb = await this.findExistingIgdbGame(igdbMatches);
      if (existingIgdb) {
        await this.linkGameToSeed(seed, existingIgdb.id);
        return `[${label}] Linked existing GameDB #${existingIgdb.id} to ${seed.title}`;
      }

      let selectedId: number | null = null;
      if (igdbMatches.length === 1) {
        selectedId = igdbMatches[0].id;
      } else {
        const selection = await this.promptForIgdbSelection(
          interaction,
          seed,
          igdbMatches,
          searchTerm,
        );
        if (selection.newQuery) {
          searchTerm = selection.newQuery;
          continue;
        }
        if (selection.skipped) {
          return `[${label}] Skipped (no selection): ${seed.title}`;
        }
        selectedId = selection.selectedId;
      }

      if (!selectedId) {
        return `[${label}] Skipped (no selection): ${seed.title}`;
      }

      return this.importGameFromIgdb(selectedId, label, seed);
    }
  }

  private async promptForIgdbSelection(
    interaction: CommandInteraction,
    seed: GameDbSeed,
    matches: IGDBGame[],
    searchTerm: string,
  ): Promise<IgdbSelectionResult> {
    const options = matches.slice(0, 23).map((game) => {
      const year = game.first_release_date
        ? new Date(game.first_release_date * 1000).getFullYear()
        : "TBD";
      const rating = game.total_rating ? ` | ${Math.round(game.total_rating)}/100` : "";
      return {
        label: `${game.name} (${year})`.substring(0, 100),
        value: String(game.id),
        description: `${rating} ${game.summary ?? "No summary"}`.substring(0, 95),
      };
    });

    options.push({
      label: "Skip (do not import this title)",
      value: "skip",
      description: "Leave this GOTM/NR-GOTM un-imported",
    });
    options.push({
      label: "Search with a different title",
      value: "search-new",
      description: "Type a new search string in this channel, then re-run the lookup",
    });

    const customId = `gamedb-import-${Date.now()}`;

    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(`Select IGDB match for "${seed.title}"`)
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    const payload = {
      content: `Multiple IGDB matches for ${seed.source} Round ${seed.round} (${seed.monthYear}).`,
      components: [row],
      fetchReply: true,
    };

    let prompt: Message | null = null;
    const existing = (this as any).__gamedbPromptMessage;
    if (existing && typeof existing.edit === "function") {
      try {
        prompt = (await existing.edit(payload as any)) as Message;
      } catch {
        prompt = null;
      }
    }

    if (!prompt) {
      prompt = (await safeReply(interaction, { ...payload, ephemeral: false })) as Message | null;
      (this as any).__gamedbPromptMessage = prompt ?? null;
    }

    if (!prompt) {
      return { selectedId: null, newQuery: null, skipped: true };
    }

    const selection = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => {
        GAMEDB_IMPORT_PROMPTS.delete(customId);
        resolve(null);
      }, 60_000);

      GAMEDB_IMPORT_PROMPTS.set(customId, (val: string | null) => {
        clearTimeout(timeout);
        GAMEDB_IMPORT_PROMPTS.delete(customId);
        resolve(val);
      });
    });

    if (selection === "skip" || selection === null) {
      return { selectedId: null, newQuery: null, skipped: true };
    }

    if (selection === "search-new") {
      const newQuery = await this.promptForNewIgdbSearch(interaction, seed, searchTerm);
      return {
        selectedId: null,
        newQuery,
        skipped: !newQuery,
      };
    }

    const selected = Number(selection);
    return {
      selectedId: Number.isFinite(selected) ? selected : null,
      newQuery: null,
      skipped: false,
    };
  }

  private async promptForNewIgdbSearch(
    interaction: CommandInteraction,
    seed: GameDbSeed,
    searchTerm: string,
  ): Promise<string | null> {
    const channel: any = interaction.channel;
    const userId = interaction.user.id;

    if (!channel || typeof channel.awaitMessages !== "function") {
      await safeReply(interaction, {
        content: "Cannot prompt for a new search; use this command in a text channel.",
        ephemeral: true,
      });
      return null;
    }

    const prompt =
      `Reply in this channel with a new search string for "${seed.title}" ` +
      `(current search: "${searchTerm}").`;

    await safeReply(interaction, { content: prompt, ephemeral: false });

    try {
      const collected = await channel.awaitMessages({
        filter: (m: any) => m.author?.id === userId,
        max: 1,
        time: 120_000,
      });

      const first = collected?.first?.();
      if (!first) return null;

      const content = (first.content ?? "").trim();
      try {
        await first.delete();
      } catch {
        // ignore delete failures
      }

      if (!content || /^cancel$/i.test(content)) {
        return null;
      }

      return content;
    } catch {
      return null;
    }
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

  @SelectMenuComponent({ id: /^gamedb-import-\d+$/ })
  async handleGamedbImportSelect(interaction: StringSelectMenuInteraction): Promise<void> {
    const resolver = GAMEDB_IMPORT_PROMPTS.get(interaction.customId);
    if (!resolver) {
      await interaction.reply({
        content: "This selection has expired or was already handled.",
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    try {
      await interaction.deferUpdate();
    } catch {
      // ignore
    }

    const val = interaction.values?.[0] ?? null;
    resolver(val);

    try {
      await interaction.message.edit({ components: [] });
    } catch {
      // ignore
    }
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
        await safeReply(interaction, { embeds: [embed], ephemeral: false });
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

async function promptUserForInput(
  interaction: CommandInteraction,
  question: string,
  timeoutMs = 120_000,
): Promise<string | null> {
  const channel: any = interaction.channel;
  const userId = interaction.user.id;

  if (!channel || typeof channel.awaitMessages !== "function") {
    await safeReply(interaction, {
      content: "Cannot prompt for additional input; this command must be used in a text channel.",
    });
    return null;
  }

  try {
    await safeReply(interaction, {
      content: `<@${userId}> ${question}`,
    });
  } catch (err) {
    console.error("Failed to send prompt message:", err);
  }

  try {
    const collected = await channel.awaitMessages({
      filter: (m: any) => m.author?.id === userId,
      max: 1,
      time: timeoutMs,
    });

    const first = collected?.first?.();
    if (!first) {
      await safeReply(interaction, {
        content: "Timed out waiting for a response. Edit cancelled.",
      });
      return null;
    }

    const content: string = (first.content ?? "").trim();
    if (!content) {
      await safeReply(interaction, {
        content: "Empty response received. Edit cancelled.",
      });
      return null;
    }

    if (/^cancel$/i.test(content)) {
      await safeReply(interaction, {
        content: "Edit cancelled.",
      });
      return null;
    }

    return content;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    try {
      await safeReply(interaction, {
        content: `Error while waiting for a response: ${msg}`,
      });
    } catch {
      // ignore
    }
    return null;
  }
}

export const AUDIT_NO_VALUE_SENTINEL = "__NO_VALUE__";

function isAuditNoValue(value: string | null | undefined): boolean {
  return value === AUDIT_NO_VALUE_SENTINEL;
}

function displayAuditValue(value: string | null | undefined): string | null {
  if (isAuditNoValue(value)) return null;
  return value ?? null;
}

function formatIGotmEntryForEdit(entry: IGotmEntry): string {
  const lines: string[] = [];
  lines.push(`Round ${entry.round} - ${entry.monthYear}`);

  if (!entry.gameOfTheMonth.length) {
    lines.push("  (no games listed)");
    return lines.join("\n");
  }

  entry.gameOfTheMonth.forEach((game, index) => {
    const num = index + 1;
    const threadId = displayAuditValue(game.threadId);
    const redditUrl = displayAuditValue(game.redditUrl);
    lines.push(`${num}) Title: ${game.title}`);
    lines.push(`   Thread: ${threadId ?? "(none)"}`);
    lines.push(`   Reddit: ${redditUrl ?? "(none)"}`);
  });

  return lines.join("\n");
}

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
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Superadmin Commands Help")
    .setDescription("Choose a `/superadmin` subcommand button to view details (server owner only).");

  const components = buildSuperAdminHelpButtons(activeTopicId);
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

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
