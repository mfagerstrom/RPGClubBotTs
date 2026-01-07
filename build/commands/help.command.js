var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, MessageFlags, } from "discord.js";
import { ButtonComponent, Discord, SelectMenuComponent, Slash } from "discordx";
import { buildAdminHelpResponse, isAdmin } from "./admin.command.js";
import { buildModHelpResponse, isModerator } from "./mod.command.js";
import { buildSuperAdminHelpResponse, isSuperAdmin } from "./superadmin.command.js";
import { safeDeferReply, safeReply, safeUpdate } from "../functions/InteractionUtils.js";
const HELP_TOPICS = [
    {
        id: "gotm",
        label: "/gotm",
        summary: "Browse GOTM history, see current nominations, and add or change your nomination.",
        syntax: "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /gotm noms | /gotm nominate title:<string> | /gotm delete-nomination",
        notes: "Search by round, month/year, or title. Set showinchat:true to share in channel; otherwise replies are private. Nominations are for the next round and close a day before voting.",
    },
    {
        id: "nr-gotm",
        label: "/nr-gotm",
        summary: "Browse NR-GOTM history, see current nominations, and add or change your nomination.",
        syntax: "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>] | /nr-gotm noms | /nr-gotm nominate title:<string> | /nr-gotm delete-nomination",
        notes: "Search by round, month/year, or title. Set showinchat:true to share in channel; otherwise replies are private. Nominations are for the next round and close a day before voting.",
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
        id: "mp-info",
        label: "/mp-info",
        summary: "See who’s shared their multiplayer info (Steam/XBL/PSN/Switch) with quick profile buttons.",
        syntax: "Syntax: /mp-info [showinchat:<boolean>] [steam:<boolean>] [xbl:<boolean>] [psn:<boolean>] [switch:<boolean>]",
        notes: "Filters default to all platforms unless you set any flag true (then others default to false). Replies are private unless showinchat:true. Use the dropdown to jump to a member’s profile.",
    },
    {
        id: "now-playing",
        label: "/now-playing",
        summary: "Manage your Now Playing list and view others'.",
        syntax: "Use /now-playing help for subcommands: list, add, remove, edit-note, delete-note.",
    },
    {
        id: "game-completion",
        label: "/game-completion",
        summary: "Log completed games (removes them from Now Playing if present).",
        syntax: "Use /game-completion help for subcommands: add, list, edit, delete.",
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
        summary: "View, edit, and search profiles; manage Now Playing; and log completed games (view/search are private by default).",
        syntax: "Use /profile help for subcommands (view/edit/search/nowplaying-add/nowplaying-remove/completion-add/completion-list/completion-edit/completion-delete) and parameters.",
    },
    {
        id: "gamedb",
        label: "/gamedb",
        summary: "Search, import, and view games from GameDB with IGDB-powered lookups.",
        syntax: "Use /gamedb help for subcommands: add, search, view, audit, help.",
        notes: "Imports pull titles/covers from IGDB. View shows GOTM/NR-GOTM wins, " +
            "nominations, and related threads for the GameDB id. Audit is admin only.",
    },
    {
        id: "publicreminder",
        label: "/publicreminder",
        summary: "Schedule public reminders with optional recurrence (admin only).",
        syntax: "Syntax: /publicreminder create channel:<channel> date:<string> time:<string> message:<string> [recur:<int>] [recurunit:<minutes|hours|days|weeks|months|years>] | /publicreminder list | /publicreminder delete id:<int>",
        notes: "Times parse in America/New_York. Recurring reminders need both recur and recurunit. Replies are private; creation shows the scheduled time.",
    },
    {
        id: "thread",
        label: "/thread",
        summary: "Link or unlink a thread to one or more GameDB games (requires Manage Threads).",
        syntax: "Syntax: /thread link thread_id:<string> gamedb_game_id:<int> | /thread unlink thread_id:<string> [gamedb_game_id:<int>]",
        notes: "Threads can have multiple linked games. Use unlink without gamedb_game_id to remove all links for the thread. Replies are private.",
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
    {
        id: "todo",
        label: "/todo",
        summary: "Manage bot development TODO items (list is public; edits are owner only).",
        syntax: "Syntax: /todo add title:<string> [details:<string>] [showinchat:<boolean>] | " +
            "/todo edit id:<int> [title:<string>] [details:<string>] [showinchat:<boolean>] | " +
            "/todo delete id:<int> [showinchat:<boolean>] | /todo complete id:<int> " +
            "[showinchat:<boolean>] | /todo list [mode:<string>] " +
            "[showinchat:<boolean>] | /todo review-suggestions",
    },
    {
        id: "suggestion",
        label: "/suggestion",
        summary: "Submit a bot suggestion for review.",
        syntax: "Syntax: /suggestion title:<string> [details:<string>]",
    },
];
const HELP_CATEGORIES = [
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
        topicIds: ["gamedb", "now-playing", "game-completion"],
    },
    {
        id: "utilities",
        name: "Utilities",
        topicIds: ["hltb", "remindme", "suggestion"],
    },
    {
        id: "server-admin",
        name: "Server Administration",
        topicIds: ["mod", "admin", "superadmin", "todo", "publicreminder", "thread", "rss"],
    },
];
function getCategoryById(id) {
    return HELP_CATEGORIES.find((cat) => cat.id === id);
}
function padCommandName(label, width = 15) {
    const name = label.startsWith("/") ? label.slice(1) : label;
    return name.padEnd(width, " ");
}
function formatCommandLine(label, summary, width = 15) {
    return `> **\`\` ${padCommandName(label, width)}\`\`** ${summary}`;
}
function buildHelpDetailsEmbed(topic) {
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
const GOTM_HELP_TOPICS = [
    {
        id: "search",
        label: "/gotm search",
        summary: "Search GOTM history by round, year/month, title, or default to current round.",
        syntax: "Syntax: /gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
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
        notes: "Ephemeral feedback; changes are announced publicly with the refreshed list. " +
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
function buildGotmHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("gotm-help-select")
        .setPlaceholder("/gotm help")
        .addOptions(GOTM_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildGotmHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
function buildRemindMeHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("remindme-help-select")
        .setPlaceholder("/remindme help")
        .addOptions(REMINDME_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildRemindMeHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
function buildProfileHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("profile-help-select")
        .setPlaceholder("/profile help")
        .addOptions(PROFILE_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildProfileHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
function buildNowPlayingHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("now-playing-help-select")
        .setPlaceholder("/now-playing help")
        .addOptions(NOW_PLAYING_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildNowPlayingHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
export function buildNowPlayingHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/now-playing commands")
        .setDescription("Choose a subcommand from the dropdown to view details.");
    const components = buildNowPlayingHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
function buildGamedbHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("gamedb-help-select")
        .setPlaceholder("/gamedb help")
        .addOptions(GAMEDB_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildGamedbHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
const NR_GOTM_HELP_TOPICS = [
    {
        id: "search",
        label: "/nr-gotm search",
        summary: "Search NR-GOTM history by round, year/month, title, or default to current round.",
        syntax: "Syntax: /nr-gotm search [round:<int>] [year:<int>] [month:<string>] [title:<string>] [showinchat:<bool>]",
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
        notes: "Ephemeral feedback; changes are announced publicly with the refreshed list. " +
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
function buildNrGotmHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("nr-gotm-help-select")
        .setPlaceholder("/nr-gotm help")
        .addOptions(NR_GOTM_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildNrGotmHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
const RSS_HELP_TOPICS = [
    {
        id: "add",
        label: "/rss add",
        summary: "Add an RSS feed relay with optional include/exclude keywords.",
        syntax: "Syntax: /rss add url:<string> channel:<channel> [name:<string>] [include:<csv>] [exclude:<csv>]",
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
        syntax: "Syntax: /rss edit id:<integer> [url:<string>] [channel:<channel>] [name:<string>] [include:<csv>] [exclude:<csv>]",
    },
    {
        id: "list",
        label: "/rss list",
        summary: "List configured RSS relays and their filters.",
        syntax: "Syntax: /rss list",
    },
];
const REMINDME_HELP_TOPICS = [
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
const PROFILE_HELP_TOPICS = [
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
        syntax: "Syntax: /profile edit [member:<user>] [completionator:<url>] [psn:<string>] [xbl:<string>] [nsw:<string>] [steam:<url>]",
        notes: "Users may edit their own fields; admins may edit any user.",
    },
    {
        id: "search",
        label: "/profile search",
        summary: "Search profiles by id/name/platform fields.",
        syntax: "Syntax: /profile search [userId:<string>] [username:<string>] [globalname:<string>] [completionator:<string>] [steam:<string>] [psn:<string>] [xbl:<string>] [nsw:<string>] [role flags...] [limit:<int>] [include-departed-members:<boolean>] [showinchat:<boolean>]",
        notes: "Filters default to partial matches; date/times use ISO formats; limit max 100; departed members are excluded unless include-departed-members is true.",
    },
];
const NOW_PLAYING_HELP_TOPICS = [
    {
        id: "list",
        label: "/now-playing list",
        summary: "Show Now Playing lists for you, someone else, or everyone.",
        syntax: "Syntax: /now-playing list [member:<user>] [all:<boolean>] [showinchat:<boolean>]",
        notes: "Defaults to a private view for one member. Set all:true to list everyone (sent publicly) with thread links when available.",
    },
    {
        id: "add",
        label: "/now-playing add",
        summary: "Add a GameDB title to your Now Playing list (max 10).",
        syntax: "Syntax: /now-playing add title:<string> [note:<string>]",
        notes: "Searches GameDB; choose from up to 24 results. Only GameDB titles are allowed; no free text.",
    },
    {
        id: "remove",
        label: "/now-playing remove",
        summary: "Remove a GameDB title from your Now Playing list.",
        syntax: "Syntax: /now-playing remove",
        notes: "Shows a dropdown of your current list to pick what to remove.",
    },
    {
        id: "edit-note",
        label: "/now-playing edit-note",
        summary: "Add or update a note for a Now Playing entry.",
        syntax: "Syntax: /now-playing edit-note",
        notes: "Select a game, then enter the note (max 500 chars).",
    },
    {
        id: "delete-note",
        label: "/now-playing delete-note",
        summary: "Delete the note from a Now Playing entry.",
        syntax: "Syntax: /now-playing delete-note",
        notes: "Select a game to clear its note.",
    },
];
const GAME_COMPLETION_HELP_TOPICS = [
    {
        id: "add",
        label: "/game-completion add",
        summary: "Log that you completed a game (removes it from Now Playing if present).",
        syntax: "Syntax: /game-completion add [game_id:<int> | title:<string>] completion_type:<choice> [completion_date:<date>] [final_playtime_hours:<number>] [note:<string>] [announce:<boolean>]",
        notes: "Completion type choices: Main Story, Main Story + Side Content, Completionist. Completion date defaults to today; playtime is optional (e.g., 42.5). Uses GameDB lookup/import if you provide a title. Set announce:true to post to the completions channel.",
    },
    {
        id: "list",
        label: "/game-completion list",
        summary: "List recent completions for you, another member, or view the leaderboard.",
        syntax: "Syntax: /game-completion list [year:<int|unknown>] [title:<string>] [member:<user>] [all:<boolean>] [showinchat:<bool>]",
        notes: "Shows your completions, another member's completions (member), or a leaderboard of all members (all).",
    },
    {
        id: "edit",
        label: "/game-completion edit",
        summary: "Edit one of your completion records.",
        syntax: "Syntax: /game-completion edit [title:<string>] [year:<int>]",
        notes: "Interactive menu to pick a completion and field to update. You can filter the selection by title or year.",
    },
    {
        id: "delete",
        label: "/game-completion delete",
        summary: "Delete one of your completion records.",
        syntax: "Syntax: /game-completion delete",
        notes: "Interactive menu to pick a completion to delete.",
    },
    {
        id: "completionator-import",
        label: "/game-completion completionator-import",
        summary: "Import completions from a Completionator CSV export.",
        syntax: "Syntax: /game-completion completionator-import action:<start|resume|status|pause|cancel> [file:<csv>]",
        notes: "Use action:start with the CSV file to begin. During review, reply with a GameDB id, skip, or pause, and choose Update Existing when you want to sync the CSV data.",
    },
];
function buildGameCompletionHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("game-completion-help-select")
        .setPlaceholder("/game-completion help")
        .addOptions(GAME_COMPLETION_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildGameCompletionHelpEmbed(topic) {
    const embed = new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
    if (topic.notes) {
        embed.addFields({ name: "Notes", value: topic.notes });
    }
    return embed;
}
export function buildGameCompletionHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/game-completion commands")
        .setDescription("Choose a subcommand from the dropdown to view details.");
    const components = buildGameCompletionHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
const GAMEDB_HELP_TOPICS = [
    {
        id: "add",
        label: "/gamedb add",
        summary: "Search IGDB and import a game into GameDB (open to all users).",
        syntax: "Syntax: /gamedb add title:<string> [igdb_id:<int>] [bulk_titles:<string>]",
        notes: "Returns a dropdown of IGDB matches; if only one result, it imports automatically. " +
            "Use igdb_id to skip search or bulk_titles (comma-separated) to import up to 5 at once. " +
            "Duplicate titles already in GameDB show an 'already imported' message.",
    },
    {
        id: "igdb_api_dump",
        label: "/gamedb igdb_api_dump",
        summary: "Dump raw IGDB API data for a title (debug/dev).",
        syntax: "Syntax: /gamedb igdb_api_dump title:<string>",
        notes: "Fetches raw JSON from IGDB search endpoint and attaches it as a file.",
    },
    {
        id: "search",
        label: "/gamedb search",
        summary: "Search GameDB titles with paged dropdown navigation.",
        syntax: "Syntax: /gamedb search [title:<string>]",
        notes: "Query is optional; omit to list all games. Results show a dropdown and Previous/Next " +
            "buttons; selecting a game shows its profile.",
    },
    {
        id: "view",
        label: "/gamedb view",
        summary: "View a GameDB entry by id or search query.",
        syntax: "Syntax: /gamedb view [game_id:<number>] [title:<string>]",
        notes: "Shows cover art, metadata, releases, and IGDB link when available, plus GOTM/NR-GOTM " +
            "associations: winning rounds (with thread/Reddit links) and nomination rounds with " +
            "nominator mentions.",
    },
    {
        id: "audit",
        label: "/gamedb audit",
        summary: "Audit GameDB for missing images or thread links (admin only).",
        syntax: "Syntax: /gamedb audit [missing_images:<boolean>] [missing_threads:<boolean>] " +
            "[auto_accept_images:<boolean>] [showinchat:<boolean>]",
        notes: "Defaults to checking both images and threads if no filters are set. " +
            "Auto-accept pulls IGDB images for all missing ones.",
    },
    {
        id: "link-versions",
        label: "/gamedb link-versions",
        summary: "Link alternate GameDB versions together (admin only).",
        syntax: "Syntax: /gamedb link-versions game_ids:<string> [showinchat:<boolean>]",
        notes: "Provide a comma-separated list of GameDB ids to link (e.g. 12, 34, 56). " +
            "Linked titles appear under Alternate Versions in /gamedb view.",
    },
];
function buildRssHelpButtons(activeId) {
    const select = new StringSelectMenuBuilder()
        .setCustomId("rss-help-select")
        .setPlaceholder("/rss help")
        .addOptions(RSS_HELP_TOPICS.map((topic) => ({
        label: topic.label,
        value: topic.id,
        description: topic.summary.slice(0, 95),
        default: topic.id === activeId,
    })))
        .addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    return [new ActionRowBuilder().addComponents(select)];
}
function buildRssHelpEmbed(topic) {
    return new EmbedBuilder()
        .setTitle(`${topic.label} help`)
        .setDescription(topic.summary)
        .addFields({ name: "Syntax", value: topic.syntax });
}
export function buildRssHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/rss commands")
        .setDescription("Choose an RSS subcommand from the dropdown to view details.");
    const components = buildRssHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildMainHelpResponse() {
    const embed = new EmbedBuilder()
        .setTitle("RPGClubUtils Commands")
        .setDescription("Use the category dropdowns below to jump straight to a command’s details.\n\n" +
        "**Monthly Games**\n" +
        `${formatCommandLine("gotm", "GOTM history and nominations")}\n` +
        `${formatCommandLine("nr-gotm", "NR-GOTM history and nominations")}\n` +
        `${formatCommandLine("noms", "See current GOTM and NR-GOTM nominations.")}\n` +
        `${formatCommandLine("round", "See the current round and winners.")}\n` +
        `${formatCommandLine("nextvote", "Check when the next vote happens.")}\n\n` +
        "**Members**\n" +
        `${formatCommandLine("profile", "View and edit member profiles.")}\n` +
        `${formatCommandLine("mp-info", "Find who has shared multiplayer info.")}\n\n` +
        "**GameDB**\n" +
        `${formatCommandLine("gamedb", "Search for games and view their details.")}\n` +
        `${formatCommandLine("now-playing", "Show Now Playing lists and thread links.")}\n` +
        `${formatCommandLine("game-completion", "Log and manage your completed games.")}\n\n` +
        "**Utilities**\n" +
        `${formatCommandLine("hltb", "Look up HowLongToBeat playtimes.")}\n` +
        `${formatCommandLine("remindme", "Set personal reminders with snooze.")}\n` +
        `${formatCommandLine("suggestion", "Submit a bot suggestion.")}\n\n` +
        "**Server Administration**\n" +
        `${formatCommandLine("mod", "Moderator tools.")}\n` +
        `${formatCommandLine("admin", "Admin tools.")}\n` +
        `${formatCommandLine("superadmin", "Server Owner tools.")}\n` +
        `${formatCommandLine("todo", "Manage bot development TODO items.")}\n` +
        `${formatCommandLine("publicreminder", "Schedule public reminders.")}\n` +
        `${formatCommandLine("thread", "Link threads to GameDB games.")}\n` +
        `${formatCommandLine("rss", "Manage RSS relays with filters.")}`);
    return {
        embeds: [embed],
        components: buildMainHelpComponents(),
    };
}
export function buildGotmHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/gotm commands")
        .setDescription("Choose a GOTM subcommand from the dropdown to view details.");
    const components = buildGotmHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildNrGotmHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/nr-gotm commands")
        .setDescription("Choose an NR-GOTM subcommand from the dropdown to view details.");
    const components = buildNrGotmHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildRemindMeHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/remindme commands")
        .setDescription("Choose a remindme subcommand from the dropdown to view details.");
    const components = buildRemindMeHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildProfileHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/profile commands")
        .setDescription("Choose a profile subcommand from the dropdown to view details.");
    const components = buildProfileHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
export function buildGamedbHelpResponse(activeTopicId) {
    const embed = new EmbedBuilder()
        .setTitle("/gamedb commands")
        .setDescription("Choose a GameDB subcommand from the dropdown to view details.");
    const components = buildGamedbHelpButtons(activeTopicId);
    return { embeds: [embed], components };
}
let BotHelp = class BotHelp {
    async help(interaction) {
        await safeDeferReply(interaction, { flags: MessageFlags.Ephemeral });
        const response = buildMainHelpResponse();
        await safeReply(interaction, {
            ...response,
            flags: MessageFlags.Ephemeral,
        });
    }
    async handleHelpCategory(interaction) {
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
    async handleCategoryCommand(interaction) {
        const [, categoryId] = interaction.customId.split(":");
        const category = getCategoryById(categoryId);
        const topicId = interaction.values?.[0];
        if (!category || topicId === "help-main") {
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        if (!topicId) {
            const response = buildCategoryHelpResponse(category.id);
            await safeUpdate(interaction, {
                ...response,
                content: "Please pick a command from the list.",
            });
            return;
        }
        const topic = HELP_TOPICS.find((entry) => entry.id === topicId);
        if (topicId === "admin") {
            const ok = await isAdmin(interaction);
            if (!ok)
                return;
        }
        if (topicId === "mod") {
            const ok = await isModerator(interaction);
            if (!ok)
                return;
        }
        if (topicId === "superadmin") {
            const ok = await isSuperAdmin(interaction);
            if (!ok)
                return;
        }
        if (!topic) {
            const response = buildCategoryHelpResponse(category.id);
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that help topic. Showing the category menu.",
            });
            return;
        }
        const topicHelpResponse = buildTopicHelpResponse(topicId);
        if (topicHelpResponse) {
            await safeUpdate(interaction, topicHelpResponse);
            return;
        }
        const helpEmbed = buildHelpDetailsEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [helpEmbed],
            components: buildCategoryComponents(category.id, topic.id),
        });
    }
    async handleGotmHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
    async handleNrGotmHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
    async handleRssHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
    async handleRemindMeHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
                content: "Sorry, I don't recognize that remindme help topic. Showing the remindme help menu.",
            });
            return;
        }
        const embed = buildRemindMeHelpEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [embed],
            components: buildRemindMeHelpButtons(topic.id),
        });
    }
    async handleProfileHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
    async handleNowPlayingHelpButton(interaction) {
        const topicId = interaction.values?.[0];
        if (topicId === "help-main") {
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        const topic = NOW_PLAYING_HELP_TOPICS.find((entry) => entry.id === topicId);
        if (!topic) {
            const response = buildNowPlayingHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that now-playing help topic. Showing the help menu.",
            });
            return;
        }
        const embed = buildNowPlayingHelpEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [embed],
            components: buildNowPlayingHelpButtons(topic.id),
        });
    }
    async handleGamedbHelpButton(interaction) {
        const topicId = interaction.values?.[0];
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
    async handleGameCompletionHelpButton(interaction) {
        const topicId = interaction.values?.[0];
        if (topicId === "help-main") {
            const response = buildMainHelpResponse();
            await safeUpdate(interaction, response);
            return;
        }
        const topic = GAME_COMPLETION_HELP_TOPICS.find((entry) => entry.id === topicId);
        if (!topic) {
            const response = buildGameCompletionHelpResponse();
            await safeUpdate(interaction, {
                ...response,
                content: "Sorry, I don't recognize that game-completion help topic. Showing the help menu.",
            });
            return;
        }
        const embed = buildGameCompletionHelpEmbed(topic);
        await safeUpdate(interaction, {
            embeds: [embed],
            components: buildGameCompletionHelpButtons(topic.id),
        });
    }
    async handleHelpMainButton(interaction) {
        const response = buildMainHelpResponse();
        await safeUpdate(interaction, response);
    }
};
__decorate([
    Slash({ description: "Show help for all bot commands", name: "help" })
], BotHelp.prototype, "help", null);
__decorate([
    SelectMenuComponent({ id: "help-main-select" })
], BotHelp.prototype, "handleHelpCategory", null);
__decorate([
    SelectMenuComponent({ id: /^help-category-select:.+/ })
], BotHelp.prototype, "handleCategoryCommand", null);
__decorate([
    SelectMenuComponent({ id: "gotm-help-select" })
], BotHelp.prototype, "handleGotmHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "nr-gotm-help-select" })
], BotHelp.prototype, "handleNrGotmHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "rss-help-select" })
], BotHelp.prototype, "handleRssHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "remindme-help-select" })
], BotHelp.prototype, "handleRemindMeHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "profile-help-select" })
], BotHelp.prototype, "handleProfileHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "now-playing-help-select" })
], BotHelp.prototype, "handleNowPlayingHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "gamedb-help-select" })
], BotHelp.prototype, "handleGamedbHelpButton", null);
__decorate([
    SelectMenuComponent({ id: "game-completion-help-select" })
], BotHelp.prototype, "handleGameCompletionHelpButton", null);
__decorate([
    ButtonComponent({ id: "help-main" })
], BotHelp.prototype, "handleHelpMainButton", null);
BotHelp = __decorate([
    Discord()
], BotHelp);
export { BotHelp };
function buildTopicHelpResponse(topicId) {
    switch (topicId) {
        case "gotm":
            return buildGotmHelpResponse();
        case "nr-gotm":
            return buildNrGotmHelpResponse();
        case "remindme":
            return buildRemindMeHelpResponse();
        case "profile":
            return buildProfileHelpResponse();
        case "game-completion":
            return buildGameCompletionHelpResponse();
        case "now-playing":
            return buildNowPlayingHelpResponse();
        case "gamedb":
            return buildGamedbHelpResponse();
        case "rss":
            return buildRssHelpResponse();
        case "admin":
            return buildAdminHelpResponse();
        case "mod":
            return buildModHelpResponse();
        case "superadmin":
            return buildSuperAdminHelpResponse();
        default:
            return null;
    }
}
function buildCategoryComponents(categoryId, activeTopicId, includeBackToMain = true) {
    const category = getCategoryById(categoryId);
    if (!category)
        return buildMainHelpComponents();
    const topics = category.topicIds
        .map((id) => HELP_TOPICS.find((t) => t.id === id))
        .filter((t) => Boolean(t));
    const select = new StringSelectMenuBuilder()
        .setCustomId(`help-category-select:${categoryId}`)
        .setPlaceholder(`${category.name} commands`)
        .addOptions(topics.map((topic) => ({
        label: topic.label,
        value: topic.id,
        default: topic.id === activeTopicId,
    })));
    if (includeBackToMain) {
        select.addOptions({ label: "Back to Help Main Menu", value: "help-main" });
    }
    return [new ActionRowBuilder().addComponents(select)];
}
function buildCategoryHelpResponse(categoryId, activeTopicId) {
    const category = getCategoryById(categoryId);
    const topics = category?.topicIds
        .map((id) => HELP_TOPICS.find((t) => t.id === id))
        .filter((t) => Boolean(t));
    const embed = new EmbedBuilder()
        .setTitle(`${category?.name ?? "Commands"}`)
        .setDescription(topics && topics.length
        ? topics.map((t) => formatCommandLine(t.label, t.summary, 10)).join("\n")
        : "No commands found for this category.");
    return {
        embeds: [embed],
        components: buildCategoryComponents(categoryId, activeTopicId),
    };
}
function buildMainHelpComponents() {
    return HELP_CATEGORIES.flatMap((category) => buildCategoryComponents(category.id, undefined, false));
}
