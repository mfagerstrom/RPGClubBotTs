import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ForumChannel,
} from "discord.js";
import type { CommandInteraction, User } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash, SlashGroup, SlashOption } from "discordx";
import { DateTime } from "luxon";
import { AnyRepliable, safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, {
  type IGotmEntry,
  type IGotmGame,
  updateGotmGameFieldInDatabase,
  type GotmEditableField,
  insertGotmRoundInDatabase,
} from "../classes/Gotm.js";
import NrGotm, {
  type INrGotmEntry,
  type INrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmEditableField,
  insertNrGotmRoundInDatabase,
} from "../classes/NrGotm.js";
import Game from "../classes/Game.js";
import BotVotingInfo from "../classes/BotVotingInfo.js";
import {
  buildNominationDeleteView,
  handleNominationDeletionButton,
  buildNominationDeleteViewEmbed,
  announceNominationChange,
} from "../functions/NominationAdminHelpers.js";
import { getUpcomingNominationWindow } from "../functions/NominationWindow.js";
import {
  deleteNominationForUser,
  getNominationForUser,
  listNominationsForRound,
} from "../classes/Nomination.js";
import { getThreadsByGameId, setThreadGameLink } from "../classes/Thread.js";

type AdminHelpTopicId =
  | "add-gotm"
  | "edit-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "delete-gotm-nomination"
  | "delete-nr-gotm-nomination"
  | "delete-gotm-noms"
  | "delete-nr-gotm-noms"
  | "set-nextvote"
  | "voting-setup"
  | "nextround-setup";

type AdminHelpTopic = {
  id: AdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

export const ADMIN_HELP_TOPICS: AdminHelpTopic[] = [
  {
    id: "nextround-setup",
    label: "/admin nextround-setup",
    summary: "Interactive wizard to setup the next round (games, threads, dates).",
    syntax: "Syntax: /admin nextround-setup",
    notes: "Walks through adding GOTM/NR-GOTM winners, linking threads, and setting the next vote date.",
  },
  {
    id: "add-gotm",
    label: "/admin add-gotm",
    summary: "Add the next GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-gotm",
    notes:
      "Round number is auto-assigned to the next open round.",
  },
  {
    id: "edit-gotm",
    label: "/admin edit-gotm",
    summary: "Update details for a specific GOTM round.",
    syntax: "Syntax: /admin edit-gotm round:<integer>",
    parameters:
      "round (required) — GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "add-nr-gotm",
    label: "/admin add-nr-gotm",
    summary: "Add the next NR-GOTM round with guided prompts.",
    syntax: "Syntax: /admin add-nr-gotm",
    notes:
      "Round number is auto-assigned to the next open NR-GOTM round.",
  },
  {
    id: "edit-nr-gotm",
    label: "/admin edit-nr-gotm",
    summary: "Update details for a specific NR-GOTM round.",
    syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
    parameters:
      "round (required) — NR-GOTM round to edit. The bot shows current data and lets you pick what to change.",
  },
  {
    id: "delete-gotm-nomination",
    label: "/admin delete-gotm-nomination",
    summary: "Remove a user’s GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set. A public update is posted with the refreshed list.",
  },
  {
    id: "delete-nr-gotm-nomination",
    label: "/admin delete-nr-gotm-nomination",
    summary: "Remove a user’s NR-GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-nr-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set. A public update is posted with the refreshed list.",
  },
  {
    id: "delete-gotm-noms",
    label: "/admin delete-gotm-noms",
    summary: "Interactive panel to delete GOTM nominations.",
    syntax: "Syntax: /admin delete-gotm-noms",
    notes: "Shows buttons to select nominations for deletion.",
  },
  {
    id: "delete-nr-gotm-noms",
    label: "/admin delete-nr-gotm-noms",
    summary: "Interactive panel to delete NR-GOTM nominations.",
    syntax: "Syntax: /admin delete-nr-gotm-noms",
    notes: "Shows buttons to select nominations for deletion.",
  },
  {
    id: "set-nextvote",
    label: "/admin set-nextvote",
    summary: "Set when the next GOTM/NR-GOTM vote will happen.",
    syntax: "Syntax: /admin set-nextvote date:<date>",
    notes: "Votes are typically held the last Friday of the month.",
  },
  {
    id: "voting-setup",
    label: "/admin voting-setup",
    summary: "Build ready-to-paste Subo /poll commands from current nominations.",
    syntax: "Syntax: /admin voting-setup",
    notes: "Pulls current nominations for GOTM and NR-GOTM, sorts answers, and sets a sensible max_select.",
  },
];

function buildAdminHelpButtons(
  activeId?: AdminHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("admin-help-select")
    .setPlaceholder("/admin help")
    .addOptions(
      ADMIN_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildAdminHelpEmbed(topic: AdminHelpTopic): EmbedBuilder {
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

export function buildAdminHelpResponse(
  activeTopicId?: AdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Admin Commands Help")
    .setDescription("Pick an `/admin` command below to see what it does and how to use it.");

  const components = buildAdminHelpButtons(activeTopicId);

  return {
    embeds: [embed],
    components,
  };
}

@Discord()
@SlashGroup({ description: "Admin Commands", name: "admin" })
@SlashGroup("admin")
export class Admin {
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

    const okToUseCommand: boolean = await isAdmin(interaction);
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
          `Next vote date updated to ${parsed.toLocaleDateString()}.`,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating next vote date: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
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
    user: User,
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

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
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
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
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
    user: User,
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

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Administrator role.", flags: MessageFlags.Ephemeral });
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
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Interactive deletion of GOTM nominations for the upcoming round",
    name: "delete-gotm-noms",
  })
  async deleteGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const window = await getUpcomingNominationWindow();
    const view = await buildNominationDeleteView("gotm", "/gotm nominate", "admin");
    if (!view) {
      await safeReply(interaction, {
        content: `No GOTM nominations found for Round ${window.targetRound}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Select a GOTM nomination to delete for Round ${window.targetRound}.`,
      embeds: [view.embed],
      components: view.components,
              flags: MessageFlags.Ephemeral,    });
  }

  @Slash({
    description: "Generate Subo /poll commands for GOTM and NR-GOTM voting",
    name: "voting-setup",
  })
  async votingSetup(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    try {
      const window = await getUpcomingNominationWindow();
      const roundNumber = window.targetRound;
      const nextMonth = (() => {
        const base = new Date();
        const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1));
        return d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
      })();
      const monthLabel = nextMonth || "the upcoming month";

      const gotmNoms = await listNominationsForRound("gotm", roundNumber);
      const nrNoms = await listNominationsForRound("nr-gotm", roundNumber);

      const buildPoll = (kindLabel: string, answers: string[]): string => {
        if (!answers.length) {
          return `${kindLabel}: (no nominations found for Round ${roundNumber})`;
        }
        const maxSelect = Math.max(1, Math.floor(answers.length / 2));
        const answersJoined = answers.join(";");
        const pollName =
          kindLabel === "GOTM"
            ? `GOTM_Round_${roundNumber}`
            : `NR-GOTM_Round_${roundNumber}`;
        const question =
          kindLabel === "GOTM"
            ? `What Roleplaying Game(s) would you like to discuss in ${monthLabel}?`
            : `What Non-Roleplaying Game(s) would you like to discuss in ${monthLabel}?`;

        // Calculate time until 8 PM Eastern
        const nowInEastern = DateTime.now().setZone("America/New_York");
        const today8pm = nowInEastern.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

        let startOutput: string;
        let timeLimitOutput: string;

        if (nowInEastern < today8pm) {
          const diff = today8pm.diff(nowInEastern).shiftTo("hours", "minutes", "seconds");
          startOutput = diff.toFormat("h'h'm'm's's");
          timeLimitOutput = "48h";
        } else {
          startOutput = "1m";
          // End at 8 PM on (Today + 2 days)
          const targetEnd = today8pm.plus({ days: 2 });
          const actualStart = nowInEastern.plus({ minutes: 1 });
          const diff = targetEnd.diff(actualStart).shiftTo("hours", "minutes", "seconds");
          timeLimitOutput = diff.toFormat("h'h'm'm's's");
        }

        return `/poll question:${question} answers:${answersJoined} max_select:${maxSelect} start:${startOutput} time_limit:${timeLimitOutput} vote_change:Yes realtime_results:🙈 Hidden privacy:🤐 Semi-private role_required:@members channel:#announcements name:${pollName} final_reveal:Yes`;
      };

      const gotmAnswers = gotmNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);
      const nrAnswers = nrNoms.map((n) => n.gameTitle).map((t) => t.trim()).filter(Boolean);

      const gotmPoll = buildPoll("GOTM", gotmAnswers);
      const nrPoll = buildPoll("NR-GOTM", nrAnswers);

      const adminChannelId = "428142514222923776";
      const adminChannel = adminChannelId
        ? await interaction.client.channels.fetch(adminChannelId).catch(() => null)
        : null;

      const messageContent = `GOTM:\n\`\`\`\n${gotmPoll}\n\`\`\`\nNR-GOTM:\n\`\`\`\n${nrPoll}\n\`\`\``;

      if (adminChannel && (adminChannel as any).send) {
        await (adminChannel as any).send({ content: messageContent });
        await safeReply(interaction, {
          content: "Voting setup commands posted to #admin.",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await safeReply(interaction, {
          content: messageContent,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not generate vote commands: ${msg}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({
    description: "Interactive deletion of NR-GOTM nominations for the upcoming round",
    name: "delete-nr-gotm-noms",
  })
  async deleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const window = await getUpcomingNominationWindow();
    const view = await buildNominationDeleteView("nr-gotm", "/nr-gotm nominate", "admin");
    if (!view) {
      await safeReply(interaction, {
        content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Select an NR-GOTM nomination to delete for Round ${window.targetRound}.`,
      embeds: [view.embed],
      components: view.components,
              flags: MessageFlags.Ephemeral,    });
  }

  @ButtonComponent({ id: /^admin-(gotm|nr-gotm)-nom-del-(\d+)-(\d+)$/ })
  async handleAdminNominationDeleteButton(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const match = interaction.customId.match(/^admin-(gotm|nr-gotm)-nom-del-(\d+)-(\d+)$/);
    if (!match) return;
    const kind = match[1] as "gotm" | "nr-gotm";
    const round = Number(match[2]);
    const userId = match[3];

    await handleNominationDeletionButton(interaction, kind, round, userId, "admin");
  }

  @Slash({ description: "Interactive setup for the next round (GOTM, NR-GOTM, dates)", name: "nextround-setup" })
  async nextRoundSetup(
    @SlashOption({
      description: "Run in test mode (no DB changes)",
      name: "testmode",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    testModeInput: boolean | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    if (interaction.channelId !== ADMIN_CHANNEL_ID) {
      await safeReply(interaction, {
        content: `This command can only be used in <#${ADMIN_CHANNEL_ID}>.`,
      });
      return;
    }

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    const testMode = !!testModeInput;
    if (testMode) {
      await safeReply(interaction, {
        content: "Running in **TEST MODE**. No changes will be committed.",
      });
    }

    let allEntries: IGotmEntry[];
    try {
      allEntries = Gotm.all();
    } catch (err: any) {
      await safeReply(interaction, { content: `Error loading data: ${err.message}` });
      return;
    }

    const nextRound = allEntries.length > 0 ? Math.max(...allEntries.map((e) => e.round)) + 1 : 1;

    await safeReply(interaction, {
      content: `**Starting setup for Round ${nextRound}.**`,
    });

    // 1. Month/Year
    const monthYearRaw = await promptUserForInput(
      interaction,
      `Enter the label for Round ${nextRound} (e.g. "April 2024").`,
    );
    if (!monthYearRaw) return;
    const monthYear = monthYearRaw.trim();

    // 2. GOTM
    const gotmGames = await setupRoundGames(interaction, "GOTM", nextRound, testMode);
    if (!gotmGames) {
      await safeReply(interaction, { content: "Aborted during GOTM setup." });
      return;
    }

    // 3. NR-GOTM
    const nrGotmGames = await setupRoundGames(interaction, "NR-GOTM", nextRound, testMode);
    if (!nrGotmGames) {
      await safeReply(interaction, { content: "Aborted during NR-GOTM setup." });
      return;
    }

    // 4. Confirm
    const confirm = await promptUserForInput(
      interaction,
      `Ready to commit Round ${nextRound} (${monthYear})?${testMode ? " (TEST MODE)" : ""}\n` +
        `GOTM: ${gotmGames.map((g) => g.title).join(", ")}\n` +
        `NR-GOTM: ${nrGotmGames.map((g) => g.title).join(", ")}\n` +
        `Type 'yes' to proceed.`,
    );
    if (confirm?.toLowerCase() !== "yes") {
      await safeReply(interaction, { content: "Cancelled." });
      return;
    }

    // 5. Commit
    if (testMode) {
      await safeReply(interaction, {
        content: `[Test Mode] Would commit rounds to DB and set round info for Round ${nextRound}.`,
      });
    } else {
      try {
        await insertGotmRoundInDatabase(nextRound, monthYear, gotmGames);
        Gotm.addRound(nextRound, monthYear, gotmGames);

        await insertNrGotmRoundInDatabase(nextRound, monthYear, nrGotmGames);
        NrGotm.addRound(nextRound, monthYear, nrGotmGames);

        await safeReply(interaction, { content: "Rounds created in database." });
      } catch (e: any) {
        await safeReply(interaction, { content: `Failed to commit rounds: ${e.message}` });
        return;
      }
    }

    // 6. Next Vote Date
    const defaultDate = calculateNextVoteDate();
    const dateStr = defaultDate.toLocaleDateString("en-US");

    const dateResp = await promptUserForInput(
      interaction,
      `When should the *next* vote be? (Default: ${dateStr}). Type 'default' or a date (YYYY-MM-DD).`,
    );

    if (!dateResp) return;

    let finalDate = defaultDate;
    if (dateResp.toLowerCase() !== "default") {
      const parsed = new Date(dateResp);
      if (!Number.isNaN(parsed.getTime())) {
        finalDate = parsed;
      } else {
        await safeReply(interaction, { content: "Invalid date. Using default." });
      }
    }

    if (testMode) {
      await safeReply(interaction, {
        content: `[Test Mode] Would set next vote date to ${finalDate.toLocaleDateString()}.`,
      });
    } else {
      try {
        await BotVotingInfo.setRoundInfo(nextRound, finalDate, null);
        await safeReply(interaction, {
          content: `Round ${nextRound} is now active! Next vote set to ${finalDate.toLocaleDateString()}.`,
        });
      } catch (e: any) {
        await safeReply(interaction, { content: `Failed to set round info: ${e.message}` });
      }
    }
  }

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
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
      if (gamedbRaw === null) return;
      const gamedbId = Number(gamedbRaw.trim());
      if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
        await safeReply(interaction, { content: "Invalid GameDB id. Creation cancelled." });
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

    const okToUseCommand: boolean = await isAdmin(interaction);
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
      if (gamedbRaw === null) return;
      const gamedbId = Number(gamedbRaw.trim());
      if (!Number.isInteger(gamedbId) || gamedbId <= 0) {
        await safeReply(interaction, { content: "Invalid GameDB id. Creation cancelled." });
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

    const okToUseCommand: boolean = await isAdmin(interaction);
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
      : `Enter the new value for ${fieldAnswer} (GameDB id required).`;

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

    const okToUseCommand: boolean = await isAdmin(interaction);
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
      : `Enter the new value for ${fieldAnswer} (GameDB id required).`;

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

  @Slash({ description: "Show help for admin commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
              flags: MessageFlags.Ephemeral,    });
  }

  @SelectMenuComponent({ id: "admin-help-select" })
  async handleAdminHelpMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as AdminHelpTopicId | "help-main" | undefined;

    if (topicId === "help-main") {
      const { buildMainHelpResponse } = await import("./help.command.js");
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = ADMIN_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that admin help topic. Showing the admin help menu.",
      });
      return;
    }

    const helpEmbed = buildAdminHelpEmbed(topic);
    const response = buildAdminHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
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

function calculateNextVoteDate(): Date {
  const now = new Date();
  // Move to next month
  const d = new Date(now.getFullYear(), now.getMonth() + 2, 0); // Last day of next month
  // Back up to Friday (5)
  while (d.getDay() !== 5) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

const NOW_PLAYING_FORUM_ID = "1059875931356938240";
const ADMIN_CHANNEL_ID = "428142514222923776";

async function setupRoundGames(

  interaction: CommandInteraction,

  label: "GOTM" | "NR-GOTM",

  roundNumber: number,

  testMode: boolean,

): Promise<

  { title: string; threadId: string | null; redditUrl: string | null; gamedbGameId: number }[] | null

> {

    const kind = label.toLowerCase() as "gotm" | "nr-gotm";

    const nominations = await listNominationsForRound(kind, roundNumber);

  

    if (nominations.length > 0) {

    const lines = nominations.map(

      (n, idx) => `${idx + 1}. **${n.gameTitle}** (by <@${n.userId}>)`,

    );

    await safeReply(interaction, {

      content: `**${label} Nominations for Round ${roundNumber}:**\n${lines.join("\n")}`,

    });



    const choiceRaw = await promptUserForInput(

      interaction,

      `Enter the number(s) of the winning game(s) (comma-separated for ties, e.g. \`1\` or \`1,3\`).\nOr type \`manual\` to enter GameDB IDs manually.`,

    );

    if (!choiceRaw) return null;



    if (choiceRaw.trim().toLowerCase() !== "manual") {

      const indices = choiceRaw

        .split(",")

        .map((s) => Number(s.trim()))

        .filter((n) => Number.isInteger(n));



      if (indices.length === 0) {

        await safeReply(interaction, { content: "No valid numbers found. Switching to manual mode." });

      } else {

        const selectedNoms = indices

          .map((i) => nominations[i - 1])

          .filter((n) => n !== undefined);



        if (selectedNoms.length === 0) {

          await safeReply(interaction, {

            content: "Invalid selection indices. Switching to manual mode.",

          });

        } else {

          // Process selected nominations

          const games: {

            title: string;

            threadId: string | null;

            redditUrl: string | null;

            gamedbGameId: number;

          }[] = [];



          for (const nom of selectedNoms) {

            await safeReply(interaction, {

              content: `Processing winner: **${nom.gameTitle}** (GameDB #${nom.gamedbGameId}).`,

            });

            const gameData = await processWinnerGame(

              interaction,

              nom.gamedbGameId,

              nom.gameTitle,

              testMode,

            );

            if (!gameData) return null;

            games.push(gameData);

          }

          return games;

        }

      }

    }

  } else {

    await safeReply(interaction, {

      content: `No nominations found for ${label} Round ${roundNumber}. Using manual mode.`,

    });

  }



  // Manual Mode

  const countRaw = await promptUserForInput(

    interaction,

    `How many ${label} winners? (1-5). Type \`cancel\` to abort.`,

  );

  if (!countRaw) return null;

  const count = Number(countRaw);

  if (!Number.isInteger(count) || count < 1 || count > 5) {

    await safeReply(interaction, { content: "Invalid count." });

    return null;

  }



  const games: {

    title: string;

    threadId: string | null;

    redditUrl: string | null;

    gamedbGameId: number;

  }[] = [];



  for (let i = 0; i < count; i++) {

    const n = i + 1;

    const gamedbRaw = await promptUserForInput(interaction, `Enter GameDB ID for ${label} #${n}.`);

    if (!gamedbRaw) return null;

    const gamedbId = Number(gamedbRaw);

    if (!Number.isInteger(gamedbId)) {

      await safeReply(interaction, { content: "Invalid ID." });

      return null;

    }



    const game = await Game.getGameById(gamedbId);

    if (!game) {

      await safeReply(interaction, { content: "Game not found." });

      return null;

    }



    const gameData = await processWinnerGame(interaction, gamedbId, game.title, testMode);

    if (!gameData) return null;

    games.push(gameData);

  }



  return games;

}



async function processWinnerGame(

  interaction: CommandInteraction,

  gamedbId: number,

  gameTitle: string,

  testMode: boolean,

): Promise<{

  title: string;

  threadId: string | null;

  redditUrl: string | null;

  gamedbGameId: number;

} | null> {

  // Check for thread

  const threads = await getThreadsByGameId(gamedbId);

  let threadId: string | null = threads.length ? threads[0] : null;



  if (threadId) {

    await safeReply(interaction, {

      content: `Found existing thread <#${threadId}> linked to this game. Using it.`,

    });

  } else {

    // Prompt to create

    const createResp = await promptUserForInput(

      interaction,

      `No linked thread found for "${gameTitle}". Create one in Now Playing? (yes/no/id)`,

    );

    if (!createResp) return null;



    if (createResp.toLowerCase() === "yes") {

      if (testMode) {

        await safeReply(interaction, {

          content: `[Test Mode] Would create and link thread for "${gameTitle}".`,

        });

        threadId = "TEST-THREAD-ID";

      } else {

        try {

          const forum = (await interaction.guild?.channels.fetch(

            NOW_PLAYING_FORUM_ID,

          )) as ForumChannel;

          if (forum) {

            const thread = await forum.threads.create({

              name: testMode ? `Sidegame - ${gameTitle}` : gameTitle,

              message: { content: `Discussion thread for **${gameTitle}**.` },

            });

            threadId = thread.id;

            await setThreadGameLink(threadId, gamedbId);

            await safeReply(interaction, {

              content: `Created and linked thread <#${threadId}>.`,

            });

          } else {

            await safeReply(interaction, {

              content: "Could not find Now Playing forum channel.",

            });

          }

        } catch (e: any) {

          await safeReply(interaction, { content: `Failed to create thread: ${e.message}` });

        }

      }

    } else if (createResp.toLowerCase() !== "no") {

      // Assume ID

      if (/^\d+$/.test(createResp)) {

        threadId = createResp;

        if (testMode) {

          await safeReply(interaction, {

            content: `[Test Mode] Would link thread <#${threadId}>.`,

          });

        } else {

          await setThreadGameLink(threadId, gamedbId);

          await safeReply(interaction, { content: `Linked thread <#${threadId}>.` });

        }

      }

    }

  }



  // Reddit

  const redditRaw = await promptUserForInput(

    interaction,

    `Enter Reddit URL for "${gameTitle}" (or 'none').`,

  );

  if (!redditRaw) return null;

  const redditUrl = redditRaw.toLowerCase() === "none" ? null : redditRaw;



  return {

    title: gameTitle,

    threadId,

    redditUrl,

    gamedbGameId: gamedbId,

  };

}

export async function isAdmin(interaction: AnyRepliable) {
  const anyInteraction = interaction as any;
  const member: any = (interaction as any).member;
  const canCheck =
    member && typeof member.permissionsIn === "function" && interaction.channel;
  const isAdmin = canCheck
    ? member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator)
    : false;

  if (!isAdmin) {
    const denial = {
      content: "Access denied. Command requires Administrator role.",
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
      // swallow to avoid leaking
    }
  }

  return isAdmin;
}
