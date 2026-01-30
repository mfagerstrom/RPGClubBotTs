You may only edit files in the current working directory.
You may only use non-destructive git commands.
After every changeset you make, run npm run lint and npm run compile and npm run test with a 30 second timeout (only when you stop working on a command).
Every time a new session is started, update COMMIT-HISTORY.md using git history.
never edit existing .sql files.  They have already been run.  Just add new files with changes.
name sql files starting with today's date with datestamp (ie 20251210_sql_script_name) YYYYMMDD_name_format
Research best practices for Discord.js and DiscordX, along with Typescript, so your coding mindset isn't out of date
review eslint.config.ts and follow all rules outlined there
Do not keep making this mistake: [ERROR] (node:30760) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.
Do not keep making this mistake: Discord slash commands require all required options to come before optional options; reorder parameters if you see DiscordAPIError[50035] about APPLICATION_COMMAND_OPTIONS_REQUIRED_INVALID.
Do not keep making this mistake: when adding helper utilities (like GameDB thumbnail helpers), ensure they are imported or defined in the file before use to avoid compile-time "cannot find name" errors.
Do not delete the build directory.
Table docs live in db folder
At the start of each session, scan the entire project and ensure that all /help content is up to date.
Never edit files in the build folder.  They're irrelevant.
Do not keep making this mistake: avoid leaving unused imports/variables after refactors; clean them up before finishing.
Do not keep making this mistake: stop reminding the user about local WSL/compile limitations—assume they'll run npm commands themselves unless they ask.
Aim for clean, centralized patterns (e.g., shared helpers/defaults) instead of duplicating magic numbers or flags across files.
Do not keep making this mistake: use Discord flags for ephemerality instead of the deprecated `ephemeral` option when sending interaction responses.
Do not keep making this mistake: when building Discord Components v2 responses, ensure the top-level components list only includes valid container types (type 1 ActionRow or proper ContainerBuilder), and keep each ActionRow to 1-5 components to avoid DiscordAPIError[50035] about UNION_TYPE_CHOICES or BASE_TYPE_BAD_LENGTH.
you are not allowed to use emdashes.
Whenever I report an error, assess and report if a custom lint rule would be useful for catching that error in the future.
All channel ID constants belong in src/config/channels.ts.
All user ID constants belong in src/config/users.ts.
All tag ID constants belong in src/config/tags.ts.