**RPGClub GameDB Feature Update**

**Timeframe**
- Changes since January 14, 2026

**/todo GitHub Issues Overhaul**
- /todo is now fully driven by GitHub issues with a menu and button driven UI.
- Components v2 layout for list and view, including sectioned issue rows and accessory buttons.
- List improvements: query filter modal, label filter dropdown with "Not Blocked" default, paging controls, create issue, close issue, and per page limits to avoid component caps.
- View improvements: inline comments rendering, Add Comment modal, Add or Edit Labels, Close Issue, Back navigation, Edit Title and Edit Description.
- Automatic refresh of list and view messages when issues are created, closed, or updated.
- Owner only and admin or moderator permissions enforced for create, edit, close, and label edits, with read access for all.
- Expired list views now refresh and re render the list with a notice for non owners.
- Comments and descriptions include Discord usernames when appropriate and now render all comments.
- /todo list is now the main /todo command, no subcommand required, and removed older /todo subcommands.
- /todo list footer now shows pending suggestion review count when non zero.
- GitHub issue text keeps underscores in titles and descriptions.

**Suggestions to GitHub Issues**
- /suggestion now supports labels via a multi select dropdown, and stores creator name and labels for approvals.
- New /suggestion-review command walks the server owner or bot dev through pending suggestions.
- Approve creates a GitHub issue and removes the suggestion from the queue.
- Reject removes the suggestion from the queue without creating an issue.
- Dev channel notification is now a short alert without action buttons.

**GameDB Release Data and Initial Release Dates**
- IGDB import now pulls release data and platform availability.
- Release entries are inserted into GAMEDB_RELEASES with platform and region mapping.
- Duplicate platform releases are now deduped by keeping the earliest release date per platform.
- GAMEDB_GAMES now stores INITIAL_RELEASE_DATE based on the earliest release date in GAMEDB_RELEASES.
- /gamedb view now displays Initial Release Date and release listings with cleaner formatting.
- Worldwide release labels removed from release display for readability.
- GameDB audit now supports release data audits, and auto accept flows for release data.

**GameDB Visual and Metadata Improvements**
- /gamedb view is now Components v2 based, with improved layout and thumbnail handling.
- Featured video support added to GameDB entries, with audit and accept flows.
- IGDB image acceptance fixes and missing image import improvements.
- GameDB titles are no longer unique, only IGDB IDs are unique to allow duplicate names.
- /gamedb search results show the release year when multiple games share the same title, including autocomplete results.
- /gamedb view shows GameDB and IGDB IDs at the bottom for quick reference.
- /gamedb view now includes HLTB cache data when available and a new HLTB UI block.
- GOTM and NR GOTM wins now include nomination credit when available, and nomination sections exclude winning rounds.

**Now Playing and Presence Updates**
- /now-playing suite received a major UI and UX overhaul.
- Now playing list layout and sorting flows improved, including modal based sorting.
- Presence based prompts now avoid repeated spam and respect opt out flows, with clearer prompts.
- Thread linking fixes so now playing entries resolve thread links reliably.

**Giveaway and Nomination Improvements**
- Game key giveaway workflow improvements and donor notification options.
- Giveaway post handling improved to update instead of reposting after restarts.
- UI and UX improvements for nomination commands.

**Game Completion Quality Improvements**
- Autocomplete for game name in completion add flows.
- Completion date off by one fix.
- Completion announcements include games per year counts.
- Duplicate completion guard prompts if the same game is logged within a week.
- Completion flows now require a platform selection from GameDB releases, with an Other option that alerts devs.
- /game-completion list now includes platform labels, with PC (Microsoft Windows) displayed as PC/Win.

**HLTB Caching and Import**
- /hltb results are now cached for GameDB titles older than 6 months to reduce scraping.
- /gamedb view can import HLTB data via a button for eligible titles.
- Cached data is displayed in /gamedb view and is not scraped on view.

**Admin and Dev Channel UX**
- Server owner commands in the bot dev channel now default to non ephemeral with interaction locks for other users.

**Cleanup and Maintenance**
- Removed deprecated commands and cleaned up legacy flows.
- Various bug fixes and small UX polish across commands.
