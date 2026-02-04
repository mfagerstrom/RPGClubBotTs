# Commit snapshot (2026-02-04)

483c18d 2026-02-04 issue-53: implemented search for game completions in common
2e6f3ac 2026-02-04 issue-160: added a required platform param featuring an autocomplete to game completion slashcommands
0afb087 2026-02-04 issue-159: gamedb view will not render an add completion button for unreleased games
090d272 2026-02-04 issue-89: New release announcements implemented
69ec8f9 2026-02-04 issue-154: gotm/nr-gotm search for year uses a single message now
854979e 2026-02-04 issue-158: /todo will no longer strip discord markdown from content
63bd69a 2026-02-04 issue-156: implemented image support for /todo view
4b95344 2026-02-04 issue-157: corrected a bug when entering completions and the dropdown for platform would disappear
d1d376a 2026-02-03 fix: corrected buildProd script
fd99e1d 2026-02-02 issue-153: Used a link for threads in nom UI
d977ad9 2026-02-02 fix: corrected errors in gotm audit
b8b8ada 2026-02-02 updated gotm audit to update existing entries with thread links and reddit urls
ef21123 2026-02-02 issue-152: nomination announcement UI fix
e107716 2026-02-02 fix: used platform abbreviations for now-playing list
ff1c321 2026-02-02 automatic backup implemented when user finishes a completionator import
e3bec5d 2026-02-02 cleanup
2ef9c78 2026-02-02 trashing the tests for now
14a99aa 2026-02-02 chore: added some unit tests
b6b7e34 2026-02-02 feat: refactored game-completion
bd4b38b 2026-02-02 refactor: split admin.command.ts into multiple files
6c276a0 2026-02-02 refactor: removed excess blank lines
e8ef0e1 2026-02-02 issue-116: remove threads from /gamedb audit
b996ab1 2026-02-02 issue-104: when viewing a closed issue, offer a reopen issue button
4608f1d 2026-02-02 issue=114: cleaned up comments in /todo view
68d5d2b 2026-02-02 issue-131: implemented stable identifiers for /suggestion review
0e9cec7 2026-02-02 issue-132: implemented stable ids for /gamedb search interactive elements
6a3623b 2026-02-02 issue-133: implemented stable ids for help menus
7e25548 2026-02-02 refactors
4b37834 2026-02-02 added some lint rules
9b180b9 2026-02-02 issue-149: implemented platform support for /now-playing
9bd94a1 2026-02-02 issue-134: autocomplete optimizations
10bb6b6 2026-02-02 issue-135: /round, /gotm search, /nr-gotm search v2 component makeover
0311e24 2026-02-02 issue-146: don't list # for the year when adding a completion with no date
a2a43f0 2026-02-01 fixes for game completion import from completionator
e9dc06e 2026-02-01 issue-143: added standard platforms for completions
bb36bfe 2026-02-01 issue-141: let usesrs choose any platform for game completions
b7d74dc 2026-02-01 issue-140: add good/bad thumbnail buttons to gamedb view
a05e94f 2026-02-01 added collection csv files, improved completionator to gamedb platform mappings
dfba2bf 2026-02-01 improved completionator seeding import to batch auto-accepted titles
edc4d21 2026-01-31 fix: improved gamedb csv import to remember mappings and skips
04b215c 2026-01-31 added csv gamedb game import from completionator
cf2a132 2026-01-31 temporarily locking down completionator imports
0ddd1cc 2026-01-30 sql table recreation scripts
f1e9904 2026-01-30 issue-136: Added more labels to /todo
715d77a 2026-01-30 issue-8: Implement a synonym system to improve searches
7884dcd 2026-01-30 issue-126: consolidated all message flag IDs into one file
8bdb6d3 2026-01-30 issue-124: consolidated all tag ids into one file.
2ed554e 2026-01-30 issue-123: consolidated all USER_ID constants into one file
d14a994 2026-01-30 issue-122: added paging to /gamedb view multi-match messages
a1be8b1 2026-01-30 issue-111: /gamedb view: padded label width is now dynamic

# Commit snapshot (2026-02-03)

d1d376a 2026-02-03 fix: corrected buildProd script
fd99e1d 2026-02-02 issue-153: Used a link for threads in nom UI
d977ad9 2026-02-02 fix: corrected errors in gotm audit
b8b8ada 2026-02-02 updated gotm audit to update existing entries with thread links and reddit urls
ef21123 2026-02-02 issue-152: nomination announcement UI fix
e107716 2026-02-02 fix: used platform abbreviations for now-playing list
ff1c321 2026-02-02 automatic backup implemented when user finishes a completionator import
e3bec5d 2026-02-02 cleanup
2ef9c78 2026-02-02 trashing the tests for now
14a99aa 2026-02-02 chore: added some unit tests
b6b7e34 2026-02-02 feat: refactored game-completion
bd4b38b 2026-02-02 refactor: split admin.command.ts into multiple files
6c276a0 2026-02-02 refactor: removed excess blank lines
e8ef0e1 2026-02-02 issue-116: remove threads from /gamedb audit
b996ab1 2026-02-02 issue-104: when viewing a closed issue, offer a reopen issue button
4608f1d 2026-02-02 issue=114: cleaned up comments in /todo view
68d5d2b 2026-02-02 issue-131: implemented stable identifiers for /suggestion review
0e9cec7 2026-02-02 issue-132: implemented stable ids for /gamedb search interactive elements
6a3623b 2026-02-02 issue-133: implemented stable ids for help menus
7e25548 2026-02-02 refactors
4b37834 2026-02-02 added some lint rules
9b180b9 2026-02-02 issue-149: implemented platform support for /now-playing
9bd94a1 2026-02-02 issue-134: autocomplete optimizations
10bb6b6 2026-02-02 issue-135: /round, /gotm search, /nr-gotm search v2 component makeover
0311e24 2026-02-02 issue-146: don't list # for the year when adding a completion with no date
a2a43f0 2026-02-01 fixes for game completion import from completionator
e9dc06e 2026-02-01 issue-143: added standard platforms for completions
bb36bfe 2026-02-01 issue-141: let usesrs choose any platform for game completions
b7d74dc 2026-02-01 issue-140: add good/bad thumbnail buttons to gamedb view
a05e94f 2026-02-01 added collection csv files, improved completionator to gamedb platform mappings
dfba2bf 2026-02-01 improved completionator seeding import to batch auto-accepted titles
edc4d21 2026-01-31 fix: improved gamedb csv import to remember mappings and skips
04b215c 2026-01-31 added csv gamedb game import from completionator
cf2a132 2026-01-31 temporarily locking down completionator imports
0ddd1cc 2026-01-30 sql table recreation scripts
f1e9904 2026-01-30 issue-136: Added more labels to /todo
715d77a 2026-01-30 issue-8: Implement a synonym system to improve searches
7884dcd 2026-01-30 issue-126: consolidated all message flag IDs into one file
8bdb6d3 2026-01-30 issue-124: consolidated all tag ids into one file.
2ed554e 2026-01-30 issue-123: consolidated all USER_ID constants into one file
d14a994 2026-01-30 issue-122: added paging to /gamedb view multi-match messages
a1be8b1 2026-01-30 issue-111: /gamedb view: padded label width is now dynamic
dd097a5 2026-01-30 issue-113: /suggestion review - implemented messaging for acceptance / rejection
64f173f 2026-01-30 issue-110: implemented stable identifiers for interactions in /todo
f1fd927 2026-01-30 issue-97: Updated Game Completion Wizard to no longer use a thread
58419a0 2026-01-30 issue-108: /gamedb-view UI/UX pass
cf89236 2026-01-29 tweaks for UI on /gamedb view
271e7c7 2026-01-29 fixes
14d9bd1 2026-01-29 issue-101: Localized all CHANNELID constants into one place
85144f3 2026-01-29 issue-106-and-100: fixed them.

# Commit snapshot (2026-02-02)

ff1c321 2026-02-02 automatic backup implemented when user finishes a completionator import
2ef9c78 2026-02-02 trashing the tests for now
14a99aa 2026-02-02 chore: added some unit tests
b6b7e34 2026-02-02 feat: refactored game-completion
bd4b38b 2026-02-02 refactor: split admin.command.ts into multiple files
6c276a0 2026-02-02 refactor: removed excess blank lines
e8ef0e1 2026-02-02 issue-116: remove threads from /gamedb audit
b996ab1 2026-02-02 issue-104: when viewing a closed issue, offer a reopen issue button
4608f1d 2026-02-02 issue=114: cleaned up comments in /todo view
68d5d2b 2026-02-02 issue-131: implemented stable identifiers for /suggestion review
0e9cec7 2026-02-02 issue-132: implemented stable ids for /gamedb search interactive elements
6a3623b 2026-02-02 issue-133: implemented stable ids for help menus
7e25548 2026-02-02 refactors
4b37834 2026-02-02 added some lint rules
9b180b9 2026-02-02 issue-149: implemented platform support for /now-playing
9bd94a1 2026-02-02 issue-134: autocomplete optimizations
10bb6b6 2026-02-02 issue-135: /round, /gotm search, /nr-gotm search v2 component makeover
0311e24 2026-02-02 issue-146: don't list # for the year when adding a completion with no date
a2a43f0 2026-02-01 fixes for game completion import from completionator
e9dc06e 2026-02-01 issue-143: added standard platforms for completions
bb36bfe 2026-02-01 issue-141: let usesrs choose any platform for game completions
b7d74dc 2026-02-01 issue-140: add good/bad thumbnail buttons to gamedb view
a05e94f 2026-02-01 added collection csv files, improved completionator to gamedb platform mappings
dfba2bf 2026-02-01 improved completionator seeding import to batch auto-accepted titles
edc4d21 2026-01-31 fix: improved gamedb csv import to remember mappings and skips
04b215c 2026-01-31 added csv gamedb game import from completionator
cf2a132 2026-01-31 temporarily locking down completionator imports
0ddd1cc 2026-01-30 sql table recreation scripts
f1e9904 2026-01-30 issue-136: Added more labels to /todo
715d77a 2026-01-30 issue-8: Implement a synonym system to improve searches
7884dcd 2026-01-30 issue-126: consolidated all message flag IDs into one file
8bdb6d3 2026-01-30 issue-124: consolidated all tag ids into one file.
2ed554e 2026-01-30 issue-123: consolidated all USER_ID constants into one file
d14a994 2026-01-30 issue-122: added paging to /gamedb view multi-match messages
a1be8b1 2026-01-30 issue-111: /gamedb view: padded label width is now dynamic
dd097a5 2026-01-30 issue-113: /suggestion review - implemented messaging for acceptance / rejection
64f173f 2026-01-30 issue-110: implemented stable identifiers for interactions in /todo
f1fd927 2026-01-30 issue-97: Updated Game Completion Wizard to no longer use a thread
58419a0 2026-01-30 issue-108: /gamedb-view UI/UX pass
cf89236 2026-01-29 tweaks for UI on /gamedb view
271e7c7 2026-01-29 fixes
14d9bd1 2026-01-29 issue-101: Localized all CHANNELID constants into one place
85144f3 2026-01-29 issue-106-and-100: fixed them.
1ac0f6c 2026-01-29 fix: tiny tweak
fc6bb85 2026-01-29 issue-99: improve hltb ui on /gamedb view
a0df681 2026-01-29 issue-102: don't strip out underscores from github issue input text
fc4fffa 2026-01-29 issue-103: don't limit the number of comments rendered for /todo view
a62199a 2026-01-29 issue-12: added platform support to game completions
b5ba719 2026-01-29 issue-96: corrected thread linking bug
d30618c 2026-01-29 issue-95: added 'not blocked' filter to /todo and made it the default
c920db3 2026-01-29 issue-93: todo menu tweak
0922f81 2026-01-29 issue-90: handle giveaway post more gracefully, don't keep recreating it
b1629d7 2026-01-29 issue-92: added autocomplete to /gamedb view
2daf360 2026-01-29 issue-91: add import hltb data button on /gamedb view for 6+ month old games
e8818b2 2026-01-29 issue-31: cache /hltb data for games over six months old to reduce scraping of the site
d0481d1 2026-01-29 issue-87: added special server owner override to make all commands public in gamedev channel in order to save time and to show users examples of how things work (when they are usually private)
54c5705 2026-01-29 issue-88: corrected missing thread links on /now-playing list
11c5e2d 2026-01-29 renamed /todo list to /todo
f6be2b9 2026-01-29 issue-83: added ids to /gamedb view
a062047 2026-01-29 issue-81-and-82: duplicate titles OK and removed redundant info from gamedb view
720a2e9 2026-01-29 issue-43: updated /suggestion to work with github issues
d8a1cf5 2026-01-29 issue-77: corrected missing action buttons when gamedb view imports
491e4d8 2026-01-29 issue-78: added Edit Title button to /todo view
