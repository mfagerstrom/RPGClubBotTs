import type { CommandInteraction } from "discord.js";
import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { Discord, SelectMenuComponent, Slash } from "discordx";
import { isAdmin } from "./admin.command.js";
import { isModerator } from "./mod.command.js";
import { isSuperAdmin } from "./superadmin.command.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";

type HelpTopicId =
  | "gotm"
  | "nr-gotm"
  | "noms"
  | "round"
  | "nextvote"
  | "hltb"
  | "coverart"
  | "now-playing"
  | "remindme"
  | "rss"
  | "mp-info"
  | "profile"
  | "gamedb"
  | "publicreminder"
  | "thread"
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

type ProfileHelpTopicId = "view" | "edit" | "search" | "nowplaying-add" | "nowplaying-remove";

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
      "Browse GOTM history, see current nominations, and add or change your pick.",
    syntax:
      "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /gotm noms | /gotm nominate title:<string> | /gotm delete-nomination",
    notes:
      "Search by round, month/year, or title. Set showinchat:true to share in channel; otherwise replies are private. Nominations are for the next round and close a day before voting.",
  },
  {
    id: "nr-gotm",
    label: "/nr-gotm",
    summary:
      "Browse NR-GOTM history, see current nominations, and add or change your pick.",
    syntax:
      "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /nr-gotm noms | /nr-gotm nominate title:<string> | /nr-gotm delete-nomination",
    notes:
      "Search by round, month/year, or title. Set showinchat:true to share in channel; otherwise replies are private. Nominations are for the next round and close a day before voting.",
  },
  {
    id: "noms",
    label: "/noms",
    summary: "Show the current GOTM and NR-GOTM nominations together (public).",
    syntax: "Syntax: /noms",
    notes: "Lists nominations for the upcoming round of each category.",
  },
  {
    id: "round",
    label: "/round",
    summary: "See the current round details and winners for GOTM and NR-GOTM.",
    syntax: "Syntax: /round [showinchat:<boolean>]",
    notes: "Replies privately by default; set showinchat:true to post in channel.",
  },
  {
    id: "nextvote",
    label: "/nextvote",
    summary: "Check when the next GOTM/NR-GOTM vote happens.",
    syntax: "Syntax: /nextvote [showinchat:<boolean>]",
    notes: "Replies privately by default; set showinchat:true to post in channel. See nominations with /noms; nominate with /gotm nominate or /nr-gotm nominate.",
  },
  {
    id: "hltb",
    label: "/hltb",
    summary: "Look up HowLongToBeat playtimes for a game.",
    syntax: "Syntax: /hltb title:<string> [showinchat:<boolean>]",
    parameters: "title (required) — game name and optional details. showinchat (optional) — set true to share in channel.",
  },
  {
    id: "coverart",
    label: "/coverart",
    summary: "Find cover art for a game using Google/HLTB data.",
    syntax: "Syntax: /coverart title:<string> [showinchat:<boolean>]",
    parameters: "title (required) — game name and optional details. showinchat (optional) — set true to share in channel.",
  },
  {
    id: "mp-info",
    label: "/mp-info",
    summary:
      "See who’s shared their multiplayer info (Steam/XBL/PSN/Switch) with quick profile buttons.",
    syntax:
      "Syntax: /mp-info [showinchat:<boolean>] [steam:<boolean>] [xbl:<boolean>] [psn:<boolean>] [switch:<boolean>]",
    notes:
      "Filters default to all platforms unless you set any flag true (then others default to false). Replies are private unless showinchat:true. Use the dropdown to jump to a member’s profile.",
  },
  {
    id: "now-playing",
    label: "/now-playing",
    summary: "Show Now Playing lists for you, someone else, or everyone.",
    syntax: "Syntax: /now-playing [member:<user>] [all:<boolean>]",
    notes:
      "Defaults to a private view for one member. Set all:true to list everyone (sent publicly) with thread links when available.",
  },
  {
    id: "remindme",
    label: "/remindme",
    summary: "Set personal reminders with snooze buttons (delivered by DM).",
    syntax: "Use /remindme help for a list of reminder subcommands, syntax, and notes.",
  },
  {
    id: "profile",
    label: "/profile",
    summary:
      "View, edit, and search profiles, and manage your Now Playing list (view/search are private by default).",
    syntax: "Use /profile help for subcommands (view/edit/search/nowplaying-add/nowplaying-remove) and parameters.",
  },
  {
    id: "gamedb",
    label: "/gamedb",
    summary:
      "Search, import, and view games from GameDB with IGDB-powered lookups.",
    syntax: "Use /gamedb help for subcommands: add, search, view, help.",
    notes:
      "Imports pull titles/covers from IGDB. View shows GOTM/NR-GOTM wins, nominations, and related threads for the GameDB id.",
  },
  {
    id: "publicreminder",
    label: "/publicreminder",
    summary: "Schedule public reminders with optional recurrence (admin only).",
    syntax:
      "Syntax: /publicreminder create channel:<channel> date:<string> time:<string> message:<string> [recur:<int>] [recurunit:<minutes|hours|days|weeks|months|years>] | /publicreminder list | /publicreminder delete id:<int>",
    notes:
      "Times parse in America/New_York. Recurring reminders need both recur and recurunit. Replies are private; creation shows the scheduled time.",
  },
  {
    id: "thread",
    label: "/thread",
    summary: "Link or unlink a thread to a GameDB game (requires Manage Threads).",
    syntax:
      "Syntax: /thread link thread_id:<string> gamedb_game_id:<int> | /thread unlink thread_id:<string>",
    notes: "Helps Now Playing entries point to the right thread. Replies are private.",
  },
  {
    id: "rss",
    label: "/rss",
    summary: "Manage RSS relays with include/exclude keywords per channel (admin only).",
    syntax: "Use /rss help for subcommands: add, remove, edit, list.",
  },
  {
    id: "admin",
    label: "/admin",
    summary: "Admin tools for presence and GOTM/NR-GOTM management.",
    syntax: "Use /admin help to see the subcommands and details.",
  },
  {
    id: "mod",
    label: "/mod",
    summary: "Moderator tools for presence and NR-GOTM management.",
    syntax: "Use /mod help to see the subcommands and details.",
  },
  {
    id: "superadmin",
    label: "/superadmin",
    summary: "Server owner tools for GOTM/NR-GOTM and presence management.",
    syntax: "Use /superadmin help to see the subcommands and details.",
  },
];

const HELP_CATEGORIES: { id: string; name: string; topicIds: HelpTopicId[] }[] = [
  {
    id: "monthly-games",
    name: "Monthly Games",
    topicIds: ["gotm", "nr-gotm", "noms", "round", "nextvote"],
  },
  {
    id: "members",
    name: "Members",
    topicIds: ["profile", "mp-info"],
  },
  {
    id: "gamedb",
    name: "GameDB",
    topicIds: ["gamedb", "now-playing"],
  },
  {
    id: "utilities",
    name: "Utilities",
    topicIds: ["hltb", "coverart", "remindme"],
  },
  {
    id: "server-admin",
    name: "Server Administration",
    topicIds: ["mod", "admin", "superadmin", "publicreminder", "thread", "rss"],
  },
];

function getCategoryById(id: string): (typeof HELP_CATEGORIES)[number] | undefined {
  return HELP_CATEGORIES.find((cat) => cat.id === id);
}

function padCommandName(label: string, width = 15): string {
  const name = label.startsWith("/") ? label.slice(1) : label;
  return name.padEnd(width, " ");
}

function formatCommandLine(label: string, summary: string): string {
  return `> **${padCommandName(label)}** ${summary}`;
}

function buildHelpButtons(): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("help-main-select")
    .setPlaceholder("Select a category")
    .addOptions(
      HELP_CATEGORIES.map((category) => ({
        label: category.name,
        value: category.id,
      })),
    );

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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
    notes:
      "Ephemeral feedback; changes are announced publicly with the refreshed list. " +
      "Game must exist in GameDB; if not, you'll be prompted to import from IGDB first.",
  },
  {
    id: "delete-nomination",
    label: "/gotm delete-nomination",
    summary: "Delete your own GOTM nomination for the upcoming round.",
    syntax: "Syntax: /gotm delete-nomination",
    notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
  },
];

function buildGotmHelpButtons(activeId?: GotmHelpTopicId): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("gotm-help-select")
    .setPlaceholder("/gotm help")
    .addOptions(
      GOTM_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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

function buildRemindMeHelpButtons(
  activeId?: RemindMeHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("remindme-help-select")
    .setPlaceholder("/remindme help")
    .addOptions(
      REMINDME_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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

function buildProfileHelpButtons(
  activeId?: ProfileHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("profile-help-select")
    .setPlaceholder("/profile help")
    .addOptions(
      PROFILE_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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

function buildGamedbHelpButtons(
  activeId?: GameDbHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("gamedb-help-select")
    .setPlaceholder("/gamedb help")
    .addOptions(
      GAMEDB_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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
    notes:
      "Ephemeral feedback; changes are announced publicly with the refreshed list. " +
      "Game must exist in GameDB; if not, you'll be prompted to import from IGDB first.",
  },
  {
    id: "delete-nomination",
    label: "/nr-gotm delete-nomination",
    summary: "Delete your own NR-GOTM nomination for the upcoming round.",
    syntax: "Syntax: /nr-gotm delete-nomination",
    notes: "Ephemeral feedback; removal is announced publicly with the refreshed list.",
  },
];

function buildNrGotmHelpButtons(
  activeId?: NrGotmHelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("nr-gotm-help-select")
    .setPlaceholder("/nr-gotm help")
    .addOptions(
      NR_GOTM_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
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
    summary: "View a member profile (private by default).",
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
  {
    id: "nowplaying-add",
    label: "/profile nowplaying-add",
    summary: "Add a GameDB title to your Now Playing list (max 10).",
    syntax: "Syntax: /profile nowplaying-add query:<string>",
    notes:
      "Searches GameDB; choose from up to 24 results. Only GameDB titles are allowed; no free text.",
  },
  {
    id: "nowplaying-remove",
    label: "/profile nowplaying-remove",
    summary: "Remove a GameDB title from your Now Playing list.",
    syntax: "Syntax: /profile nowplaying-remove game:<GameDB id from your list>",
    notes:
      "Remove by selecting a GameDB id that is already in your Now Playing list. List is capped at 10 entries.",
  },
];

const GAMEDB_HELP_TOPICS: GameDbHelpTopic[] = [
  {
    id: "add",
    label: "/gamedb add",
    summary: "Search IGDB and import a game into GameDB (open to all users).",
    syntax: "Syntax: /gamedb add title:<string> [igdb_id:<int>] [bulk_titles:<string>]",
    notes:
      "Returns a dropdown of IGDB matches; if only one result, it imports automatically. " +
      "Use igdb_id to skip search or bulk_titles (comma-separated) to import up to 5 at once. " +
      "Duplicate titles already in GameDB show an 'already imported' message.",
  },
  {
    id: "search",
    label: "/gamedb search",
    summary: "Search GameDB titles with paged dropdown navigation.",
    syntax: "Syntax: /gamedb search [query:<string>]",
    notes:
      "Query is optional; omit to list all games. Results show a dropdown and Previous/Next " +
      "buttons; selecting a game shows its profile.",
  },
  {
    id: "view",
    label: "/gamedb view",
    summary: "View a GameDB entry by id.",
    syntax: "Syntax: /gamedb view game_id:<number>",
    notes:
      "Shows cover art, metadata, releases, and IGDB link when available, plus GOTM/NR-GOTM " +
      "associations: winning rounds (with thread/Reddit links) and nomination rounds with " +
      "nominator mentions.",
  },
];

function buildRssHelpButtons(activeId?: RssHelpTopicId): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId("rss-help-select")
    .setPlaceholder("/rss help")
    .addOptions(
      RSS_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildRssHelpEmbed(topic: RssHelpTopic): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${topic.label} help`)
    .setDescription(topic.summary)
    .addFields({ name: "Syntax", value: topic.syntax });
}

export function buildRssHelpResponse(
  activeTopicId?: RssHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/rss commands")
    .setDescription("Choose an RSS subcommand from the dropdown to view details.");

  const components = buildRssHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildMainHelpResponse(): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle("RPGClubUtils Commands")
    .setDescription(
      "Pick a category from the dropdown to see its commands.\n\n" +
        "**Monthly Games**\n" +
        `${formatCommandLine("``gotm``", "GOTM history, nominations, and your pick.")}\n` +
        `${formatCommandLine("``nr-gotm``", "NR-GOTM history, nominations, and your pick.")}\n` +
        `${formatCommandLine("``noms``", "See current GOTM and NR-GOTM nominations.")}\n` +
        `${formatCommandLine("``round``", "See the current round and winners.")}\n` +
        `${formatCommandLine("``nextvote``", "Check when the next vote happens.")}\n\n` +
        "**Members**\n" +
        `${formatCommandLine("``profile``", "View and edit member profiles and Now Playing.")}\n` +
        `${formatCommandLine("``mp-info``", "Find who has shared multiplayer info.")}\n\n` +
        "**GameDB**\n" +
        `${formatCommandLine("``gamedb``", "Search/import games and view GameDB details.")}\n` +
        `${formatCommandLine("``now-playing``", "Show Now Playing lists and thread links.")}\n\n` +
        "**Utilities**\n" +
        `${formatCommandLine("``hltb``", "Look up HowLongToBeat playtimes.")}\n` +
        `${formatCommandLine("``coverart``", "Grab cover art for a game.")}\n` +
        `${formatCommandLine("``remindme``", "Set personal reminders with snooze.")}\n\n` +
        "**Server Administration**\n" +
        `${formatCommandLine("``mod``", "Moderator tools.")}\n` +
        `${formatCommandLine("``admin``", "Admin tools.")}\n` +
        `${formatCommandLine("``superadmin``", "Server Owner tools.")}\n` +
        `${formatCommandLine("``publicreminder``", "Schedule public reminders.")}\n` +
        `${formatCommandLine("``thread``", "Link threads to GameDB games.")}\n` +
        `${formatCommandLine("``rss``", "Manage RSS relays with filters.")}`,
    );

  return {
    embeds: [embed],
    components: buildHelpButtons(),
  };
}

export function buildGotmHelpResponse(
  activeTopicId?: GotmHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/gotm commands")
    .setDescription("Choose a GOTM subcommand from the dropdown to view details.");

  const components = buildGotmHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildNrGotmHelpResponse(
  activeTopicId?: NrGotmHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/nr-gotm commands")
    .setDescription("Choose an NR-GOTM subcommand from the dropdown to view details.");

  const components = buildNrGotmHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildRemindMeHelpResponse(
  activeTopicId?: RemindMeHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/remindme commands")
    .setDescription("Choose a remindme subcommand from the dropdown to view details.");

  const components = buildRemindMeHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildProfileHelpResponse(
  activeTopicId?: ProfileHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/profile commands")
    .setDescription("Choose a profile subcommand from the dropdown to view details.");

  const components = buildProfileHelpButtons(activeTopicId);
  return { embeds: [embed], components };
}

export function buildGamedbHelpResponse(
  activeTopicId?: GameDbHelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const embed = new EmbedBuilder()
    .setTitle("/gamedb commands")
    .setDescription("Choose a GameDB subcommand from the dropdown to view details.");

  const components = buildGamedbHelpButtons(activeTopicId);
  return { embeds: [embed], components };
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

  @SelectMenuComponent({ id: "help-main-select" })
  async handleHelpCategory(interaction: StringSelectMenuInteraction): Promise<void> {
    const categoryId = interaction.values?.[0];
    const category = categoryId ? getCategoryById(categoryId) : undefined;

    if (!category) {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that help category. Showing the main menu.",
      });
      return;
    }

    const response = buildCategoryHelpResponse(category.id);
    await safeUpdate(interaction, response);
  }

  @SelectMenuComponent({ id: /^help-category-select:.+/ })
  async handleCategoryCommand(interaction: StringSelectMenuInteraction): Promise<void> {
    const [, categoryId] = interaction.customId.split(":");
    const category = getCategoryById(categoryId);
    const topicId = interaction.values?.[0] as HelpTopicId | "help-main" | undefined;

    if (!category || topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }

    const topic = HELP_TOPICS.find((entry) => entry.id === topicId);

    if (topicId === "admin") {
      const ok = await isAdmin(interaction);
      if (!ok) return;
    }

    if (topicId === "mod") {
      const ok = await isModerator(interaction);
      if (!ok) return;
    }

    if (topicId === "superadmin") {
      const ok = await isSuperAdmin(interaction);
      if (!ok) return;
    }

    if (!topic) {
      const response = buildCategoryHelpResponse(category.id);
      await safeUpdate(interaction, {
        ...response,
        content: "Sorry, I don't recognize that help topic. Showing the category menu.",
      });
      return;
    }

    const helpEmbed = buildHelpDetailsEmbed(topic);
    await safeUpdate(interaction, {
      embeds: [helpEmbed],
      components: buildCategoryComponents(category.id, topic.id),
    });
  }

  @SelectMenuComponent({ id: "gotm-help-select" })
  async handleGotmHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as GotmHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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

  @SelectMenuComponent({ id: "nr-gotm-help-select" })
  async handleNrGotmHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as NrGotmHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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

  @SelectMenuComponent({ id: "rss-help-select" })
  async handleRssHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as RssHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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

  @SelectMenuComponent({ id: "remindme-help-select" })
  async handleRemindMeHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as RemindMeHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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

  @SelectMenuComponent({ id: "profile-help-select" })
  async handleProfileHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as ProfileHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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

  @SelectMenuComponent({ id: "gamedb-help-select" })
  async handleGamedbHelpButton(interaction: StringSelectMenuInteraction): Promise<void> {
    const topicId = interaction.values?.[0] as GameDbHelpTopicId | "help-main" | undefined;
    if (topicId === "help-main") {
      const response = buildMainHelpResponse();
      await safeUpdate(interaction, response);
      return;
    }
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
function buildCategoryComponents(
  categoryId: string,
  activeTopicId?: HelpTopicId,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const category = getCategoryById(categoryId);
  if (!category) return buildHelpButtons();

  const topics = category.topicIds
    .map((id) => HELP_TOPICS.find((t) => t.id === id))
    .filter((t): t is HelpTopic => Boolean(t));

  const select = new StringSelectMenuBuilder()
    .setCustomId(`help-category-select:${categoryId}`)
    .setPlaceholder(`${category.name} commands`)
    .addOptions(
      topics.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeTopicId,
      })),
    )
    .addOptions({ label: "Back to Help Main Menu", value: "help-main" });

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

function buildCategoryHelpResponse(
  categoryId: string,
  activeTopicId?: HelpTopicId,
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const category = getCategoryById(categoryId);
  const topics = category?.topicIds
    .map((id) => HELP_TOPICS.find((t) => t.id === id))
    .filter((t): t is HelpTopic => Boolean(t));

  const embed = new EmbedBuilder()
    .setTitle(`${category?.name ?? "Commands"}`)
    .setDescription(
      topics && topics.length
        ? topics.map((t) => formatCommandLine(t.label, t.summary)).join("\n")
        : "No commands found for this category.",
    );

  return {
    embeds: [embed],
    components: buildCategoryComponents(categoryId, activeTopicId),
  };
}
