import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionsBitField,
} from "discord.js";
import type {
  ButtonInteraction,
  CommandInteraction,
  RepliableInteraction,
  User,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  getPresenceHistory,
  setPresence,
  setPresenceFromInteraction,
  type IPresenceHistoryEntry,
} from "../functions/SetPresence.js";
import { AnyRepliable, safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
import type { Message } from "discord.js";
import { buildGotmEntryEmbed, buildNrGotmEntryEmbed } from "../functions/GotmEntryEmbeds.js";
import Gotm, {
  type GotmEntry,
  type GotmGame,
  updateGotmGameFieldInDatabase,
  type GotmEditableField,
  insertGotmRoundInDatabase,
} from "../classes/Gotm.js";
import NrGotm, {
  type NrGotmEntry,
  type NrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmEditableField,
  insertNrGotmRoundInDatabase,
} from "../classes/NrGotm.js";
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

type AdminHelpTopicId =
  | "presence"
  | "add-gotm"
  | "edit-gotm"
  | "add-nr-gotm"
  | "edit-nr-gotm"
  | "delete-gotm-nomination"
  | "delete-nr-gotm-nomination"
  | "set-nextvote"
  | "voting-setup";

type AdminHelpTopic = {
  id: AdminHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

const ADMIN_PRESENCE_CHOICES = new Map<string, string[]>();

export const ADMIN_HELP_TOPICS: AdminHelpTopic[] = [
  {
    id: "presence",
    label: "/admin presence",
    summary: 'Set the bot\'s "Now Playing" text or browse/restore presence history.',
    syntax: "Syntax: /admin presence [text:<string>]",
    parameters: "text (optional string) - new presence text; omit to see recent history and restore.",
  },
  {
    id: "add-gotm",
    label: "/admin add-gotm",
    summary: "Interactively add a new GOTM round.",
    syntax: "Syntax: /admin add-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest GOTM round.",
  },
  {
    id: "edit-gotm",
    label: "/admin edit-gotm",
    summary: "Interactively edit GOTM data for a given round.",
    syntax: "Syntax: /admin edit-gotm round:<integer>",
    parameters:
      "round (required integer) - GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "add-nr-gotm",
    label: "/admin add-nr-gotm",
    summary: "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round.",
    syntax: "Syntax: /admin add-nr-gotm",
    notes:
      "The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
  },
  {
    id: "edit-nr-gotm",
    label: "/admin edit-nr-gotm",
    summary: "Interactively edit NR-GOTM data for a given round.",
    syntax: "Syntax: /admin edit-nr-gotm round:<integer>",
    parameters:
      "round (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
  },
  {
    id: "delete-gotm-nomination",
    label: "/admin delete-gotm-nomination",
    summary: "Delete any GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "delete-nr-gotm-nomination",
    label: "/admin delete-nr-gotm-nomination",
    summary: "Delete any NR-GOTM nomination for the upcoming round and announce it.",
    syntax: "Syntax: /admin delete-nr-gotm-nomination user:<user> reason:<string>",
    notes: "Targets the upcoming nomination set (current round + 1). Announcement is posted publicly with the updated list.",
  },
  {
    id: "set-nextvote",
    label: "/admin set-nextvote",
    summary: "Set the date of the next GOTM/NR-GOTM vote.",
    syntax: "Syntax: /admin set-nextvote date:<date>",
    notes: "Votes are typically held the last Friday of the month.",
  },
  {
    id: "voting-setup",
    label: "/admin voting-setup",
    summary: "Create copy/pasteable /poll commands for Subo.",
    syntax:
      "Syntax: /admin voting-setup",
    notes: "Uses current nomination data for GOTM and NR-GOTM; answers are auto-sorted and max_select is floor(count/2) (minimum 1).",
  },
];

function buildAdminHelpButtons(activeId?: AdminHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(ADMIN_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`admin-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  return rows;
}

function extractAdminTopicId(customId: string): AdminHelpTopicId | null {
  const prefix = "admin-help-";
  const startIndex = customId.indexOf(prefix);
  if (startIndex === -1) return null;

  const raw = customId.slice(startIndex + prefix.length).trim();
  return (ADMIN_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null) as AdminHelpTopicId | null;
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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export function buildAdminHelpResponse(
  activeTopicId?: AdminHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Admin Commands Help")
    .setDescription("Choose an `/admin` subcommand button to view details.");

  const components = buildAdminHelpButtons(activeTopicId);
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

function buildAdminPresenceButtons(count: number): ActionRowBuilder<ButtonBuilder>[] {
  const buttons: ButtonBuilder[] = [];

  for (let i = 0; i < count; i++) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`admin-presence-restore-${i}`)
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
        .setCustomId("admin-presence-cancel")
        .setLabel("No")
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

async function showAdminPresenceHistory(interaction: CommandInteraction): Promise<void> {
  const limit = 5;
  const entries = await getPresenceHistory(limit);

  if (!entries.length) {
    await safeReply(interaction, {
      content: "No presence history found.",
      ephemeral: true,
    });
    return;
  }

  const embed = buildPresenceHistoryEmbed(entries);
  const components = buildAdminPresenceButtons(entries.length);

  await safeReply(interaction, {
    embeds: [embed],
    components,
    ephemeral: true,
  });

  try {
    const msg = (await interaction.fetchReply()) as Message | undefined;
    if (msg?.id) {
      ADMIN_PRESENCE_CHOICES.set(
        msg.id,
        entries.map((e) => e.activityName ?? ""),
      );
    }
  } catch {
    // ignore
  }
}

@Discord()
@SlashGroup({ description: "Admin Commands", name: "admin" })
@SlashGroup("admin")
export class Admin {
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
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      await safeReply(interaction, { content: "Access denied. Command requires Administrator role.", ephemeral: true });
      return;
    }

    if (text && text.trim()) {
      await setPresence(interaction, text.trim());
      await safeReply(interaction, {
        content: `I'm now playing: ${text.trim()}!`,
        ephemeral: true,
      });
      return;
    }

    await showAdminPresenceHistory(interaction);
  }

  @ButtonComponent({ id: /^admin-presence-restore-\d+$/ })
  async handleAdminPresenceRestore(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    const entries = messageId ? ADMIN_PRESENCE_CHOICES.get(messageId) : undefined;
    const idx = Number(interaction.customId.replace("admin-presence-restore-", ""));

    if (!entries || !Number.isInteger(idx) || idx < 0 || idx >= entries.length) {
      await safeUpdate(interaction, {
        content: "Sorry, I couldn't find that presence entry. Please run `/admin presence` again.",
        components: [],
      });
      if (messageId) ADMIN_PRESENCE_CHOICES.delete(messageId);
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
      if (messageId) ADMIN_PRESENCE_CHOICES.delete(messageId);
    }
  }

  @ButtonComponent({ id: "admin-presence-cancel" })
  async handleAdminPresenceCancel(interaction: ButtonInteraction): Promise<void> {
    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) return;

    const messageId = interaction.message?.id;
    if (messageId) ADMIN_PRESENCE_CHOICES.delete(messageId);

    await safeUpdate(interaction, {
      content: "No presence was restored.",
      components: [],
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

    const okToUseCommand: boolean = await isAdmin(interaction);
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
          `Next vote date updated to ${parsed.toLocaleDateString()}.`,
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Error updating next vote date: ${msg}`,
        ephemeral: true,
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
      await safeReply(interaction, { content: "Access denied. Command requires Administrator role.", ephemeral: true });
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
        ephemeral: true,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Select a GOTM nomination to delete for Round ${window.targetRound}.`,
      embeds: [view.embed],
      components: view.components,
      ephemeral: true,
    });
  }

  @Slash({
    description: "Generate Subo /poll commands for GOTM and NR-GOTM voting",
    name: "voting-setup",
  })
  async votingSetup(
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

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
        return `/poll question:${question} answers:${answersJoined} max_select:${maxSelect} start:0 time_limit:48h vote_change:Yes realtime_results:🙈 Hidden privacy:🤐 Semi-private role_required:@members channel:#announcements name:${pollName} final_reveal:Yes`;
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
          ephemeral: true,
        });
      } else {
        await safeReply(interaction, {
          content: messageContent,
          ephemeral: true,
        });
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Could not generate vote commands: ${msg}`,
        ephemeral: true,
      });
    }
  }

  @Slash({
    description: "Interactive deletion of NR-GOTM nominations for the upcoming round",
    name: "delete-nr-gotm-noms",
  })
  async deleteNrGotmNomsPanel(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const window = await getUpcomingNominationWindow();
    const view = await buildNominationDeleteView("nr-gotm", "/nr-gotm nominate", "admin");
    if (!view) {
      await safeReply(interaction, {
        content: `No NR-GOTM nominations found for Round ${window.targetRound}.`,
        ephemeral: true,
      });
      return;
    }

    await safeReply(interaction, {
      content: `Select an NR-GOTM nomination to delete for Round ${window.targetRound}.`,
      embeds: [view.embed],
      components: view.components,
      ephemeral: true,
    });
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

  @Slash({ description: "Add a new GOTM round", name: "add-gotm" })
  async addGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    let allEntries: GotmEntry[];
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

    const games: GotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const titleRaw = await promptUserForInput(
        interaction,
        `Enter the title for game #${n}.`,
      );
      if (titleRaw === null) {
        return;
      }
      const title = titleRaw.trim();
      if (!title) {
        await safeReply(interaction, {
          content: "Game title cannot be empty. Creation cancelled.",
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
        title,
        threadId,
        redditUrl,
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

    let allEntries: NrGotmEntry[];
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

    const games: NrGotmGame[] = [];

    for (let i = 0; i < gameCount; i++) {
      const n = i + 1;

      const titleRaw = await promptUserForInput(
        interaction,
        `Enter the title for NR-GOTM game #${n}.`,
      );
      if (titleRaw === null) {
        return;
      }
      const title = titleRaw.trim();
      if (!title) {
        await safeReply(interaction, {
          content: "Game title cannot be empty. Creation cancelled.",
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
        title,
        threadId,
        redditUrl,
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

    let entries: GotmEntry[];
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
      "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: GotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "title") {
      field = "title";
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
      : `Enter the new value for ${fieldAnswer}.`;

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    }

    try {
      await updateGotmGameFieldInDatabase(roundNumber, gameIndex, field!, newValue);

      let updatedEntry: GotmEntry | null = null;
      if (field === "title") {
        updatedEntry = Gotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
      } else if (field === "threadId") {
        updatedEntry = Gotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = Gotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
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

    let entries: NrGotmEntry[];
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
      "Which field do you want to edit? Type one of: `title`, `thread`, `reddit`. Type `cancel` to abort.",
    );
    if (fieldAnswerRaw === null) {
      return;
    }

    const fieldAnswer = fieldAnswerRaw.toLowerCase();
    let field: NrGotmEditableField | null = null;
    let nullableField = false;

    if (fieldAnswer === "title") {
      field = "title";
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
      : `Enter the new value for ${fieldAnswer}.`;

    const valueAnswerRaw = await promptUserForInput(interaction, valuePrompt, 5 * 60_000);
    if (valueAnswerRaw === null) {
      return;
    }

    const valueTrimmed = valueAnswerRaw.trim();
    let newValue: string | null = valueTrimmed;

    if (nullableField && /^none|null$/i.test(valueTrimmed)) {
      newValue = null;
    }

    try {
      await updateNrGotmGameFieldInDatabase({
        rowId: entry.gameOfTheMonth?.[gameIndex]?.id ?? null,
        round: roundNumber,
        gameIndex,
        field: field!,
        value: newValue,
      });

      let updatedEntry: NrGotmEntry | null = null;
      if (field === "title") {
        updatedEntry = NrGotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
      } else if (field === "threadId") {
        updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
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
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isAdmin(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildAdminHelpResponse();

    await safeReply(interaction, {
      ...response,
      ephemeral: true,
    });
  }

  @ButtonComponent({ id: /^admin-help-.+/ })
  async handleAdminHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = extractAdminTopicId(interaction.customId);
    const topic = topicId ? ADMIN_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

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

function formatGotmEntryForEdit(entry: GotmEntry): string {
  const lines: string[] = [];
  lines.push(`Round ${entry.round} - ${entry.monthYear}`);

  if (!entry.gameOfTheMonth.length) {
    lines.push("  (no games listed)");
    return lines.join("\n");
  }

  entry.gameOfTheMonth.forEach((game, index) => {
    const num = index + 1;
    lines.push(`${num}) Title: ${game.title}`);
    lines.push(`   Thread: ${game.threadId ?? "(none)"}`);
    lines.push(`   Reddit: ${game.redditUrl ?? "(none)"}`);
  });

  return lines.join("\n");
}

export async function isAdmin(interaction: AnyRepliable) {
  const anyInteraction = interaction as any;
  // @ts-ignore
  const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

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
    } catch (err: any) {
      // swallow to avoid leaking
    }
  }

  return isAdmin;
}
