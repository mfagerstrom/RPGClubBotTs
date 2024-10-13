export const todoText: string =
`
**TO DO**

Automation
- triggered by specific dates
  - nomination reminders
  - automatic messaging of reminders via private message to user
  - automatic vote setup [requires home grown voting mechanism]
  - automatic output of nominations in admin channel on vote day
  - automatic output of vote bot setup strings in admin channel on vote day
- triggered by discord events
  - on member join - automatic restoration of roles on re-join 
  - on member role assignment - record role in member roles table
  - on event create - automatic creation of live events threads (but not for voting events)
  - on member part - record part date in members table
  - on member nickname change - record old nickname in member nicknames table if it does not   
    already exist there
  - on member nickname change - record new nickname in member nicknames table
- triggered by bot functions
  - automatic creation of events for voting rounds

Voting
- set up vote round function [admin only]
- delete nomination function [admin only]
- edit existing nomination [self only with admin only override]
- output vote bot setup strings [admin only]
- replace current vote bot functionality 

Reference
- function that gives friend codes / online usernames for a given user (from a dropdown)
- function that lets you set your own friend codes / online usernames
- function that outputs the full GOTM / NR GOTM history
- function that outputs the GOTM / NR for a given month (by date)
- function that outputs the GOTM / NR for a given round
- function that outputs the round for a given game title
- function that checks if a game has been featured before
  - call this when nominating as a warning?
- function that lets a user set a reminder for themselves
- function that offers help for all /slashcommands, chosen from dropdown
- function that gives completionator profile urls for a given user (from a dropdown)
- function that lets you set your own completionator profile url
- function that gives previous nicknames for a user

Admin
- report: how long have newcomers been on the server without participating?
- report: how long have members been with us but not been given regulars?
- report: regulars that do not have longstanding-members role, and how long they have been on the server?
- re-implement channel migration functionality from RPGClubBotJs

`;