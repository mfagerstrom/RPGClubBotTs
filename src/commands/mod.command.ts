import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
} from "discord.js";
import type {
  ButtonInteraction,
  CommandInteraction,
  RepliableInteraction,
} from "discord.js";
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import { getPresenceHistory, setPresence } from "../functions/SetPresence.js";
import { AnyRepliable, safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";

type ModHelpTopicId = "presence" | "presence-history";

type ModHelpTopic = {
  id: ModHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
};

export const MOD_HELP_TOPICS: ModHelpTopic[] = [
  {
    id: "presence",
    label: "/mod presence",
    summary: 'Set the bot\'s "Now Playing" text.',
    syntax: "Syntax: /mod presence text:<string>",
    parameters: "text (required string) - new presence text.",
  },
  {
    id: "presence-history",
    label: "/mod presence-history",
    summary: "Show the most recent presence changes.",
    syntax: "Syntax: /mod presence-history [count:<integer>]",
    parameters: "count (optional integer, default 5, max 50) - number of entries.",
  },
];

function buildModHelpButtons(activeId?: ModHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(MOD_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`mod-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  return rows;
}

function extractModTopicId(customId: string): ModHelpTopicId | null {
  const prefix = "mod-help-";
  const startIndex = customId.indexOf(prefix);
  if (startIndex === -1) return null;

  const raw = customId.slice(startIndex + prefix.length).trim();
  return (MOD_HELP_TOPICS.find((entry) => entry.id === raw)?.id ?? null) as ModHelpTopicId | null;
}

export function buildModHelpEmbed(topic: ModHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.parameters) {
    embed.addFields({ name: "Parameters", value: topic.parameters });
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

  @Slash({ description: "Show help for moderator commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const okToUseCommand: boolean = await isModerator(interaction);
    if (!okToUseCommand) {
      return;
    }

    const response = buildModHelpResponse();

    await safeReply(interaction, {
      ...response,
      ephemeral: true,
    });
  }

  @ButtonComponent({ id: /^mod-help-.+/ })
  async handleModHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = extractModTopicId(interaction.customId);
    const topic = topicId ? MOD_HELP_TOPICS.find((entry) => entry.id === topicId) : null;

    if (!topic) {
      const response = buildModHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that moderator help topic. Showing the moderator help menu.",
      });
      return;
    }

    const helpEmbed = buildModHelpEmbed(topic);
    const response = buildModHelpResponse(topic.id);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: response.components,
    });
  }
}

export async function isModerator(interaction: AnyRepliable) {
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
export function buildModHelpResponse(
  activeTopicId?: ModHelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("Moderator Commands Help")
    .setDescription("Choose a `/mod` subcommand button to view details.");

  const components = buildModHelpButtons(activeTopicId);
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
