**RPGClubBot Update**

**Timeframe**
- Changes since January 14, 2026

**/todo GitHub Issues Overhaul**
- /todo is now fully driven by GitHub issues with a menu and button driven UI.
- Components v2 layout for list and view, including sectioned issue rows and accessory buttons.
- List improvements: query filter modal, label filter dropdown, paging controls, create issue, close issue, and per page limits to avoid component caps.
- View improvements: inline comments rendering, Add Comment modal, Add/Edit Labels, Close Issue, Back navigation, and Edit Description modal.
- Automatic refresh of list and view messages when issues are created, closed, or updated.
- Owner only and admin/moderator permissions enforced for create, edit, close, and label edits, with read access for all.
- Expired list views now refresh and re render the list with a notice for non owners.
- Comments and descriptions include Discord usernames when appropriate.

**GameDB Release Data and Initial Release Dates**
- IGDB import now pulls release data and platform availability.
- Release entries are inserted into GAMEDB_RELEASES with platform and region mapping.
- Duplicate platform releases are now deduped by keeping the earliest release date per platform.
- GAMEDB_GAMES now stores INITIAL_RELEASE_DATE based on the earliest release date in GAMEDB_RELEASES.
- /gamedb view now displays Initial Release Date and release listings with cleaner formatting.
- Worldwide release labels removed from release display for readability.

**GameDB Visual and Metadata Improvements**
- /gamedb view is now Components v2 based, with improved layout and thumbnail handling.
- Featured video support added to GameDB entries, with audit and accept flows.
- IGDB image acceptance fixes and missing image import improvements.

**Now Playing and Presence Updates**
- /now-playing suite received a major UI and UX overhaul.
- Now playing list layout and sorting flows improved, including modal based sorting.
- Presence based prompts now avoid repeated spam and respect opt out flows, with clearer prompts.

**Giveaway and Nomination Improvements**
- Game key giveaway workflow improvements and donor notification options.
- UI and UX improvements for nomination commands.

**Game Completion Quality Improvements**
- Autocomplete for game name in completion add flows.
- Completion date off by one fix.
- Completion announcements include games per year counts.

**Cleanup and Maintenance**
- Removed deprecated commands and cleaned up legacy flows.
- Various bug fixes and small UX polish across commands.
