1. Correct existing Lint errors

2. Fix this:
[LOG] [SlashCommand] /superadmin by merph518 in #🤖︱rpgclubbot_development
[ERROR] (node:16652) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.

3. Complete member.ts class based on RPG_CLUB_USERS table (and /superadmin memberscan population of that table).  Move any functions around getting and setting values in that table to this new class.

4. Troubleshoot why the bot's presence falls off after 8+ hours.  Suggest a good solution to this, or fall back to just setting the presence every 3 hours or something based on the current presence in the databse.

5. Game Lookup 
- image, sourced from /coverart command
- paragraph about game
- release date
- HLTB info
- metacritic rating

6. Watched Game List
- members keep a list of games they are interested in notifications for
- bot watches news channel and livestream threads, if a string matches one of the items on someone's watch list, they get a notification
- notification message would give an option to remove a game from your list if you're no longer interested
- there would need to be some kind of limitation on how often it messages, maybe compiling a day's worth of links into a single message?

7. RemindMe 
- users can set reminders for themselves at any date/time
- database table used, including a column for if a message has been relayed yet
- offer user the option to snooze notification until another date
- /remindme menu returns a list of all reminders with the help text on how to manage the list

8. Member profile
- nickname, previous nicknames
- avatar
- multiplayer info
- member since <join date>
- optional, member-set profile text

9. Completionator Functionality
- Profile scraping for data
- Games I’m playing
- Games I’ve finished
- Games I want to play
- Profile link

10. Smart scheduling of Subo poll start/stop

11. Voting Functionality

12. Rules Menu

13. Explanations and Procedures added to help menu

14. Live Event Utilities