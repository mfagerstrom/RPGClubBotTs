import type { ButtonInteraction, CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { ButtonComponent, Discord, Slash } from "discordx";
import { buildAdminHelpResponse, isAdmin } from "./admin.command.js";
import { buildModHelpResponse, isModerator } from "./mod.command.js";
import { buildSuperAdminHelpResponse, isSuperAdmin } from "./superadmin.command.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";

type HelpTopicId =
  | "gotm"
  | "nr-gotm"
  | "noms"
  | "round"
  | "nextvote"
  | "hltb"
  | "coverart"
  | "remindme"
  | "rss"
  | "mp-info"
  | "profile"
  | "gamedb"
  | "admin"
  | "mod"
  | "superadmin";

type HelpTopic = {
  id: HelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  parameters?: string;
  notes?: string;
};

type GotmHelpTopicId = "search" | "noms" | "nominate" | "delete-nomination";

type GotmHelpTopic = {
  id: GotmHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type NrGotmHelpTopicId = "search" | "noms" | "nominate" | "delete-nomination";

type NrGotmHelpTopic = {
  id: NrGotmHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type RemindMeHelpTopicId = "create" | "menu" | "snooze" | "delete";

type RemindMeHelpTopic = {
  id: RemindMeHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type ProfileHelpTopicId = "view" | "edit" | "search";

type ProfileHelpTopic = {
  id: ProfileHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

type GameDbHelpTopicId = "add" | "search" | "view";

type GameDbHelpTopic = {
  id: GameDbHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
  notes?: string;
};

const HELP_TOPICS: HelpTopic[] = [
  {
    id: "gotm",
    label: "/gotm",
    summary:
      "GOTM commands: search history, list nominations (public), nominate or delete your own nomination (ephemeral).",
    syntax:
      "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /gotm noms | /gotm nominate title:<string> | /gotm delete-nomination",
    notes:
      "Search: round takes precedence; year+month target a specific month; title searches by game title; set showinchat:true to post publicly. Noms is public. Nominations target the upcoming round (current round + 1) and close one day before the vote.",
  },
  {
    id: "nr-gotm",
    label: "/nr-gotm",
    summary:
      "NR-GOTM commands: search history, list nominations (public), nominate or delete your own nomination (ephemeral).",
    syntax:
      "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /nr-gotm noms | /nr-gotm nominate title:<string> | /nr-gotm delete-nomination",
    notes:
      "Search: round takes precedence; year+month target a specific month; title searches by game title; set showinchat:true to post publicly. Noms is public. Nominations target the upcoming round (current round + 1) and close one day before the vote.",
  },
  {
    id: "noms",
    label: "/noms",
    summary: "Show both GOTM and NR-GOTM current nominations (public).",
    syntax: "Syntax: /noms",
    notes: "Lists the upcoming round nominations for GOTM and NR-GOTM together.",
  },
  {
    id: "round",
    label: "/round",
    summary: "Show the current voting round, including GOTM and NR-GOTM winners (ephemeral by default).",
    syntax: "Syntax: /round [showinchat:<boolean>]",
    notes: "Set showinchat:true to post publicly.",
  },
  {
    id: "nextvote",
    label: "/nextvote",
    summary: "Show the date of the next GOTM/NR-GOTM vote (ephemeral by default).",
    syntax: "Syntax: /nextvote [showinchat:<boolean>]",
    notes: "Set showinchat:true to post publicly. See nominations with /noms; nominate via /gotm nominate or /nr-gotm nominate.",
  },
  {
    id: "hltb",
    label: "/hltb",
    summary: "Search HowLongToBeat for game completion times (ephemeral by default).",
    syntax: "Syntax: /hltb title:<string> [showinchat:<boolean>]",
    parameters: "title (required string) - game title and optional descriptors. showinchat (optional boolean) - post publicly if true.",
  },
  {
    id: "coverart",
    label: "/coverart",
    summary: "Search for video game cover art using Google/HLTB data (ephemeral by default).",
    syntax: "Syntax: /coverart title:<string> [showinchat:<boolean>]",
    parameters: "title (required string) - game title and optional descriptors. showinchat (optional boolean) - post publicly if true.",
  },
  {
    id: "mp-info",
    label: "/mp-info",
    summary:
      "List members who have shared multiplayer platform info with quick profile buttons (ephemeral by default).",
    syntax:
      "Syntax: /mp-info [showinchat:<boolean>] [steam:<boolean>] [xbl:<boolean>] [psn:<boolean>] [switch:<boolean>]",
    notes:
      "Platform filters default to true; if any flag is true, unspecified platforms default to " +
      "false. Set showinchat:true to post publicly. Pick a member from the dropdown to open " +
      "their profile.",
  },
  {
    id: "remindme",
    label: "/remindme",
    summary: "Personal reminders with quick snooze buttons (DM delivery).",
    syntax: "Use /remindme help for a list of reminder subcommands, syntax, and notes.",
  },
  {
    id: "profile",
    label: "/profile",
    summary:
      "View, edit, or search stored RPG_CLUB_USERS profiles (view/search are ephemeral by default).",
    syntax: "Use /profile help for subcommands (view/edit/search) and parameters.",
  },
  {
    id: "gamedb",
    label: "/gamedb",
    summary: "Game database tools powered by IGDB search, import, and paging results.",
    syntax: "Use /gamedb help for subcommands: add, search, view.",
  },
  {
    id: "rss",
    label: "/rss",
    summary: "Admin-only RSS relays with include/exclude keyword filters per channel.",
    syntax: "Use /rss help for subcommands: add, remove, edit, list.",
  },
  {
    id: "admin",
    label: "/admin",
    summary: "Admin-only commands for managing bot presence and GOTM/NR-GOTM data.",
    syntax: "Use /admin help for a detailed list of admin subcommands, their syntax, and parameters.",
  },
  {
    id: "mod",
    label: "/mod",
    summary: "Moderator commands for managing bot presence and NR-GOTM data.",
    syntax: "Use /mod help for a detailed list of moderator subcommands, their syntax, and parameters.",
  },
  {
    id: "superadmin",
    label: "/superadmin",
    summary: "Server owner commands for GOTM/NR-GOTM management and bot presence.",
    syntax: "Use /superadmin help for a detailed list of server owner subcommands, their syntax, and parameters.",
  },
];

function buildHelpButtons(activeId?: HelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  return rows;
}

function buildHelpDetailsEmbed(topic: HelpTopic): EmbedBuilder {
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

const GOTM_HELP_TOPICS: GotmHelpTopic[] = [
  {
    id: "search",
    label: "/gotm search",
    summary: "Search GOTM history by round, year/month, title, or default to current round.",
    syntax:
      "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
    notes: "Ephemeral by default; set showinchat:true to post publicly.",
  },
  {
    id: "noms",
    label: "/gotm noms",
    summary: "Public list of current GOTM nominations for the upcoming round.",
    syntax: "Syntax: /gotm noms",
  },
  {
    id: "nominate",
    label: "/gotm nominate",
    summary: "Submit or update your GOTM nomination for the upcoming round.",
    syntax: "Syntax: /gotm nominate title:<string>",
    notes: "Ephemeral feedback; changes are announced publicly with the refreshed list.",
  },
  {
    id: "delete-nomination",
    label: "/gotm delete-nomination",
    summary: "Delete your own GOTM nomination for the upcoming round.",
    syntax: "Syntax: /gotm delete-nomination",
    notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
  },
];

function buildGotmHelpButtons(activeId?: GotmHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(GOTM_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`gotm-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return rows;
}

function buildGotmHelpEmbed(topic: GotmHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function buildRemindMeHelpButtons(activeId?: RemindMeHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      REMINDME_HELP_TOPICS.map((topic) =>
        new ButtonBuilder()
          .setCustomId(`remindme-help-${topic.id}`)
          .setLabel(topic.label)
          .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildRemindMeHelpEmbed(topic: RemindMeHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function buildProfileHelpButtons(activeId?: ProfileHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      PROFILE_HELP_TOPICS.map((topic) =>
        new ButtonBuilder()
          .setCustomId(`profile-help-${topic.id}`)
          .setLabel(topic.label)
          .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildProfileHelpEmbed(topic: ProfileHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

function buildGamedbHelpButtons(activeId?: GameDbHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      GAMEDB_HELP_TOPICS.map((topic) =>
        new ButtonBuilder()
          .setCustomId(`gamedb-help-${topic.id}`)
          .setLabel(topic.label)
          .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildGamedbHelpEmbed(topic: GameDbHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

const NR_GOTM_HELP_TOPICS: NrGotmHelpTopic[] = [
  {
    id: "search",
    label: "/nr-gotm search",
    summary: "Search NR-GOTM history by round, year/month, title, or default to current round.",
    syntax:
      "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
    notes: "Ephemeral by default; set showinchat:true to post publicly.",
  },
  {
    id: "noms",
    label: "/nr-gotm noms",
    summary: "Public list of current NR-GOTM nominations for the upcoming round.",
    syntax: "Syntax: /nr-gotm noms",
  },
  {
    id: "nominate",
    label: "/nr-gotm nominate",
    summary: "Submit or update your NR-GOTM nomination for the upcoming round.",
    syntax: "Syntax: /nr-gotm nominate title:<string>",
    notes: "Ephemeral feedback; changes are announced publicly with the refreshed list.",
  },
  {
    id: "delete-nomination",
    label: "/nr-gotm delete-nomination",
    summary: "Delete your own NR-GOTM nomination for the upcoming round.",
    syntax: "Syntax: /nr-gotm delete-nomination",
    notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
  },
];

function buildNrGotmHelpButtons(activeId?: NrGotmHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  for (const chunk of chunkArray(NR_GOTM_HELP_TOPICS, 5)) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        chunk.map((topic) =>
          new ButtonBuilder()
            .setCustomId(`nr-gotm-help-${topic.id}`)
            .setLabel(topic.label)
            .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
        ),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return rows;
}

function buildNrGotmHelpEmbed(topic: NrGotmHelpTopic): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });

  if (topic.notes) {
    embed.addFields({ name: "Notes", value: topic.notes });
  }

  return embed;
}

type RssHelpTopicId = "add" | "remove" | "edit" | "list";

type RssHelpTopic = {
  id: RssHelpTopicId;
  label: string;
  summary: string;
  syntax: string;
};

const RSS_HELP_TOPICS: RssHelpTopic[] = [
  {
    id: "add",
    label: "/rss add",
    summary: "Add an RSS feed relay with optional include/exclude keywords.",
    syntax:
      "Syntax: /rss add url:<string> channel:<channel> [name:<string>] [include:<csv>] [exclude:<csv>]",
  },
  {
    id: "remove",
    label: "/rss remove",
    summary: "Remove an existing RSS relay by id.",
    syntax: "Syntax: /rss remove id:<integer>",
  },
  {
    id: "edit",
    label: "/rss edit",
    summary: "Update an existing RSS relay (url/channel/name/include/exclude).",
    syntax:
      "Syntax: /rss edit id:<integer> [url:<string>] [channel:<channel>] [name:<string>] [include:<csv>] [exclude:<csv>]",
  },
  {
    id: "list",
    label: "/rss list",
    summary: "List configured RSS relays and their filters.",
    syntax: "Syntax: /rss list",
  },
];

const REMINDME_HELP_TOPICS: RemindMeHelpTopic[] = [
  {
    id: "create",
    label: "/remindme create",
    summary: "Create a reminder delivered by DM with quick snooze buttons.",
    syntax: "Syntax: /remindme create when:<date/time> [note:<text>]",
    notes: "Use natural inputs like 'in 45m' or absolute datetimes; must be at least 1 minute ahead.",
  },
  {
    id: "menu",
    label: "/remindme menu",
    summary: "Show your reminders and usage help.",
    syntax: "Syntax: /remindme menu",
    notes: "Lists your reminders with ids and snooze/delete options.",
  },
  {
    id: "snooze",
    label: "/remindme snooze",
    summary: "Snooze a reminder to a new time.",
    syntax: "Syntax: /remindme snooze id:<int> until:<date/time>",
  },
  {
    id: "delete",
    label: "/remindme delete",
    summary: "Delete a reminder by id.",
    syntax: "Syntax: /remindme delete id:<int>",
  },
];

const PROFILE_HELP_TOPICS: ProfileHelpTopic[] = [
  {
    id: "view",
    label: "/profile view",
    summary: "View a member profile (ephemeral by default).",
    syntax: "Syntax: /profile view [member:<user>] [showinchat:<boolean>]",
    notes: "Omit member to view your own profile; set showinchat:true to post publicly.",
  },
  {
    id: "edit",
    label: "/profile edit",
    summary: "Edit a profile's platform links/handles (self or admin).",
    syntax:
      "Syntax: /profile edit [member:<user>] [completionator:<url>] [psn:<string>] [xbl:<string>] [nsw:<string>] [steam:<url>]",
    notes: "Users may edit their own fields; admins may edit any user.",
  },
  {
    id: "search",
    label: "/profile search",
    summary: "Search profiles by id/name/platform fields.",
    syntax:
      "Syntax: /profile search [userId:<string>] [username:<string>] [globalname:<string>] [completionator:<string>] [steam:<string>] [psn:<string>] [xbl:<string>] [nsw:<string>] [role flags...] [limit:<int>] [include-departed-members:<boolean>] [showinchat:<boolean>]",
    notes:
      "Filters default to partial matches; date/times use ISO formats; limit max 100; departed members are excluded unless include-departed-members is true.",
  },
];

const GAMEDB_HELP_TOPICS: GameDbHelpTopic[] = [
  {
    id: "add",
    label: "/gamedb add",
    summary: "Search IGDB and import a game into GameDB (open to all users).",
    syntax: "Syntax: /gamedb add title:<string>",
    notes:
      "Returns a dropdown of IGDB matches; if only one result, it imports automatically. Duplicate titles already in GameDB show an 'already imported' message.",
  },
  {
    id: "search",
    label: "/gamedb search",
    summary: "Search GameDB titles with paged dropdown navigation.",
    syntax: "Syntax: /gamedb search [query:<string>]",
    notes:
      "Query is optional; omit to list all games. Results show a dropdown and Previous/Next buttons; selecting a game shows its profile.",
  },
  {
    id: "view",
    label: "/gamedb view",
    summary: "View a GameDB entry by id.",
    syntax: "Syntax: /gamedb view game_id:<number>",
    notes: "Shows cover art, metadata, releases, and IGDB link when available.",
  },
];

function buildRssHelpButtons(activeId?: RssHelpTopicId): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      RSS_HELP_TOPICS.map((topic) =>
        new ButtonBuilder()
          .setCustomId(`rss-help-${topic.id}`)
          .setLabel(topic.label)
          .setStyle(topic.id === activeId ? ButtonStyle.Secondary : ButtonStyle.Primary),
      ),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("help-main")
        .setLabel("Back to Help Main Menu")
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return rows;
}

function buildRssHelpEmbed(topic: RssHelpTopic): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
}

export function buildRssHelpResponse(
  activeTopicId?: RssHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/rss commands")
    .setDescription("Choose an RSS subcommand button to view details.");

  const components = buildRssHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildMainHelpResponse(
  activeTopicId?: HelpTopicId,
): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("RPG Club Bot Help")
    .setDescription("Choose a command button below to see its syntax and notes.");

  return {
    embeds: [embed],
    components: buildHelpButtons(activeTopicId),
  };
}

export function buildGotmHelpResponse(
  activeTopicId?: GotmHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/gotm commands")
    .setDescription("Choose a GOTM subcommand button to view details.");

  const components = buildGotmHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildNrGotmHelpResponse(
  activeTopicId?: NrGotmHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/nr-gotm commands")
    .setDescription("Choose an NR-GOTM subcommand button to view details.");

  const components = buildNrGotmHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildRemindMeHelpResponse(
  activeTopicId?: RemindMeHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/remindme commands")
    .setDescription("Choose a remindme subcommand button to view details.");

  const components = buildRemindMeHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildProfileHelpResponse(
  activeTopicId?: ProfileHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/profile commands")
    .setDescription("Choose a profile subcommand button to view details.");

  const components = buildProfileHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildGamedbHelpResponse(
  activeTopicId?: GameDbHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/gamedb commands")
    .setDescription("Choose a GameDB subcommand button to view details.");

  const components = buildGamedbHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  for (const item of items) {
    current.push(item);
    if (current.length === chunkSize) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) {
    chunks.push(current);
  }
  return chunks;
}

@Discord()
export class BotHelp {
  @Slash({ description: "Show help for all bot commands", name: "help" })
  async help(interaction: CommandInteraction): Promise<void> {
    await safeDeferReply(interaction, { ephemeral: true });

    const response = buildMainHelpResponse();

    await safeReply(interaction, {
      ...response,
      ephemeral: true,
    });
  }

  @ButtonComponent({ id: /^help-.+/ })
  async handleHelpButton(interaction: ButtonInteraction): Promise<void> {
    if (interaction.customId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topicId = interaction.customId.replace("help-", "") as HelpTopicId;
    const topic = HELP_TOPICS.find((entry) => entry.id === topicId);

    if (topicId === "admin") {
      const ok = await isAdmin(interaction);
      if (!ok) return;

      const response = buildAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
      });
      return;
    }

    if (topicId === "mod") {
      const ok = await isModerator(interaction);
      if (!ok) return;

      const response = buildModHelpResponse();
      await safeUpdate(interaction, {
        ...response,
      });
      return;
    }

    if (topicId === "superadmin") {
      const ok = await isSuperAdmin(interaction);
      if (!ok) return;

      const response = buildSuperAdminHelpResponse();
      await safeUpdate(interaction, {
        ...response,
      });
      return;
    }

    if (topicId === "gotm") {
      const response = buildGotmHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (topicId === "nr-gotm") {
      const response = buildNrGotmHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (topicId === "remindme") {
      const response = buildRemindMeHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (topicId === "profile") {
      const response = buildProfileHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (topicId === "gamedb") {
      const response = buildGamedbHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (topicId === "rss") {
      const response = buildRssHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    if (!topic) {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that help topic. Showing the main help menu.",
      });
      return;
    }

    const helpEmbed = buildHelpDetailsEmbed(topic);

    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: buildHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^gotm-help-.+/ })
  async handleGotmHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("gotm-help-", "") as GotmHelpTopicId;
    const topic = GOTM_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildGotmHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that GOTM help topic. Showing the GOTM help menu.",
      });
      return;
    }

    const embed = buildGotmHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildGotmHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^nr-gotm-help-.+/ })
  async handleNrGotmHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("nr-gotm-help-", "") as NrGotmHelpTopicId;
    const topic = NR_GOTM_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildNrGotmHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that NR-GOTM help topic. Showing the NR-GOTM help menu.",
      });
      return;
    }

    const embed = buildNrGotmHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildNrGotmHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^rss-help-.+/ })
  async handleRssHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("rss-help-", "") as RssHelpTopicId;
    const topic = RSS_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildRssHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that RSS help topic. Showing the RSS help menu.",
      });
      return;
    }

    const embed = buildRssHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildRssHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^remindme-help-.+/ })
  async handleRemindMeHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("remindme-help-", "") as RemindMeHelpTopicId;
    const topic = REMINDME_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildRemindMeHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content:
          "Sorry, I don't recognize that remindme help topic. Showing the remindme help menu.",
      });
      return;
    }

    const embed = buildRemindMeHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildRemindMeHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^profile-help-.+/ })
  async handleProfileHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("profile-help-", "") as ProfileHelpTopicId;
    const topic = PROFILE_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildProfileHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that profile help topic. Showing the profile help menu.",
      });
      return;
    }

    const embed = buildProfileHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildProfileHelpButtons(topic.id),
    });
  }

  @ButtonComponent({ id: /^gamedb-help-.+/ })
  async handleGamedbHelpButton(interaction: ButtonInteraction): Promise<void> {
    const topicId = interaction.customId.replace("gamedb-help-", "") as GameDbHelpTopicId;
    const topic = GAMEDB_HELP_TOPICS.find((entry) => entry.id === topicId);

    if (!topic) {
      const response = buildGamedbHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that gamedb help topic. Showing the gamedb help menu.",
      });
      return;
    }

    const embed = buildGamedbHelpEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [embed],
      components: buildGamedbHelpButtons(topic.id),
    });
  }
}
