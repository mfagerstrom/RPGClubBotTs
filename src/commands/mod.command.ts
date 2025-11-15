import { ApplicationCommandOptionType, EmbedBuilder, PermissionsBitField } from "discord.js";
import type { CommandInteraction } from "discord.js";
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import { safeDeferReply, safeReply } from "../functions/InteractionUtils.js";
import NrGotm, {
  type NrGotmEntry,
  type NrGotmGame,
  updateNrGotmGameFieldInDatabase,
  type NrGotmEditableField,
  insertNrGotmRoundInDatabase,
} from "../classes/NrGotm.js";

@Discord()
@SlashGroup({ description: "Moderator Commands", name: "mod" })
@SlashGroup("mod")
export class Mod {
  @Slash({ description: "Set Presence", name: "presence" })
  async presence(
    @SlashOption({
      description: "What should the 'Now Playing' value be?",
      name: "text",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    text: string,
    interaction: CommandInteraction
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);

    if (okToUseCommand) {
      await setPresence(
        interaction,
        text
      );
      await safeReply(interaction, {
        content: `I'm now playing: ${text}!`
      });
    }
  }

  @Slash({ description: "Show presence history", name: "presence-history" })
  async presenceHistory(
    @SlashOption({
      description: "How many entries to show (default 5, max 50)",
      name: "count",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    count: number | undefined,
    interaction: CommandInteraction,
  ): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const limit =
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(1, Math.min(50, Math.trunc(count)))
        : 5;

    const entries = await getPresenceHistory(limit);

    if (!entries.length) {
      await safeReply(interaction, {
        content: "No presence history found.",
      });
      return;
    }

    const lines = entries.map((entry) => {
      const timestamp =
        entry.setAt instanceof Date ? entry.setAt.toLocaleString() : String(entry.setAt);
      const userDisplay = entry.setByUsername ?? entry.setByUserId ?? "unknown user";
      return `• [${timestamp}] ${entry.activityName} (set by ${userDisplay})`;
    });

    const header = `Last ${entries.length} presence entr${
      entries.length === 1 ? "y" : "ies"
    }:\n`;

    await safeReply(interaction, {
      content: header + lines.join("\n"),
    });
  }

  @Slash({ description: "Add a new NR-GOTM round", name: "add-nr-gotm" })
  async addNrGotm(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);
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
      await insertNrGotmRoundInDatabase(nextRound, monthYear, games);
      const newEntry = NrGotm.addRound(nextRound, monthYear, games);
      const summary = formatGotmEntryForEdit(newEntry);

      await safeReply(interaction, {
        content: [
          `Created NR-GOTM round ${nextRound}.`,
          "",
          "New data:",
          "```",
          summary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to create NR-GOTM round ${nextRound}: ${msg}`,
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

    const okToUseCommand: boolean = await isModerator(interaction);
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

    const summary = formatGotmEntryForEdit(entry);

    await safeReply(interaction, {
      content: [
        `Editing NR-GOTM round ${roundNumber}.`,
        "",
        "Current data:",
        "```",
        summary,
        "```",
      ].join("\n"),
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
      await updateNrGotmGameFieldInDatabase(roundNumber, gameIndex, field!, newValue);

      let updatedEntry: NrGotmEntry | null = null;
      if (field === "title") {
        updatedEntry = NrGotm.updateTitleByRound(roundNumber, newValue ?? "", gameIndex);
      } else if (field === "threadId") {
        updatedEntry = NrGotm.updateThreadIdByRound(roundNumber, newValue, gameIndex);
      } else if (field === "redditUrl") {
        updatedEntry = NrGotm.updateRedditUrlByRound(roundNumber, newValue, gameIndex);
      }

      const updatedSummary = updatedEntry
        ? formatGotmEntryForEdit(updatedEntry)
        : summary;

      await safeReply(interaction, {
        content: [
          `NR-GOTM round ${roundNumber} updated successfully.`,
          "",
          "Updated data:",
          "```",
          updatedSummary,
          "```",
        ].join("\n"),
      });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await safeReply(interaction, {
        content: `Failed to update NR-GOTM round ${roundNumber}: ${msg}`,
      });
    }
  }

  @Slash({ description: "Show help for moderator commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction);

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Moderator Commands Help")
      .setDescription("Available `/mod` subcommands")
      .addFields(
        {
          name: "/mod presence",
          value:
            "Set the bot's \"Now Playing\" text.\n" +
            "**Syntax:** `/mod presence text:<string>`\n" +
            "**Parameters:** `text` (required string) - new presence text.",
        },
        {
          name: "/mod presence-history",
          value:
            "Show the most recent presence changes.\n" +
            "**Syntax:** `/mod presence-history [count:<integer>]`\n" +
            "**Parameters:** `count` (optional integer, default 5, max 50) - number of entries.",
        },
        {
          name: "/mod add-nr-gotm",
          value:
            "Interactively add a new NR-GOTM (Non-RPG Game of the Month) round.\n" +
            "**Syntax:** `/mod add-nr-gotm`\n" +
            "**Notes:** The round number is always assigned automatically as the next round after the current highest NR-GOTM round.",
        },
        {
          name: "/mod edit-nr-gotm",
          value:
            "Interactively edit NR-GOTM data for a given round.\n" +
            "**Syntax:** `/mod edit-nr-gotm round:<integer>`\n" +
            "**Parameters:** `round` (required integer) - NR-GOTM round number to edit. The bot will show current data and prompt you for which game and field to update.",
        },
        {
          name: "/mod help",
          value:
            "Show this help information.\n" +
            "**Syntax:** `/mod help`",
        },
      );

    await safeReply(interaction, {
      embeds: [embed],
    });
  }
}

// @Discord()
// export class Mod {
//   @Slash({ description: "Moderator-only commands" })
//   async mod(
//     interaction: CommandInteraction,
//   ): Promise<void> {
//     const okToUseCommand: boolean = await isModerator(interaction);

//     if (okToUseCommand) {
//       await interaction.reply({
//         content: 'Nice.  You\'re in.'
//       });
//     }
//   }
// }

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

function formatGotmEntryForEdit(entry: NrGotmEntry): string {
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

export async function isModerator(interaction: CommandInteraction) {
  // @ts-ignore
  let isMod = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.ManageMessages);

  if (!isMod) {
    // @ts-ignore
    const isAdmin = await interaction.member.permissionsIn(interaction.channel).has(PermissionsBitField.Flags.Administrator);

    if (!isAdmin) {
      await safeReply(interaction, {
        content: 'Access denied.  Command requires Moderator role or above.'
      });
    } else {
      isMod = true;
    }
  }

  return isMod;
}
