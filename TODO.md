1. Fix this:
[LOG] [SlashCommand] /superadmin by merph518 in #🤖︱rpgclubbot_development
[ERROR] (node:16652) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.

2. Game Lookup 
- image, sourced from /coverart command
- paragraph about game
- release date
- HLTB info
- metacritic rating

3. Watched Game List
- members keep a list of games they are interested in notifications for
- bot watches news channel and livestream threads, if a string matches one of the items on someone's watch list, they get a notification
- notification message would give an option to remove a game from your list if you're no longer interested
- there would need to be some kind of limitation on how often it messages, maybe compiling a day's worth of links into a single message?

4. RemindMe 
- users can set reminders for themselves at any date/time
- database table used, including a column for if a message has been relayed yet
- offer user the option to snooze notification until another date
- /remindme menu returns a list of all reminders with the help text on how to manage the list

5. Member profile
- nickname, previous nicknames
- avatar
- multiplayer info
- member since <join date>
- optional, member-set profile text

6. Completionator Functionality
- Profile scraping for data
- Games I’m playing
- Games I’ve finished
- Games I want to play
- Profile link

7. Smart scheduling of Subo poll start/stop

8. Voting Functionality

9. Rules Menu

10. Explanations and Procedures added to help menu

11. Live Event Utilities