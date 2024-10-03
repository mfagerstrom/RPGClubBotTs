**IN PROGRESS**

feature implementation - member data tracking - merph518
- populate database tables
  - members
- triggered by discord events
  - on member join - record member and join date in members table
  - on member part - record part date in members table

feature implementation - member nickname tracking - merph518
- create database table
  - member nicknames
- triggered by discord events
  - on member nickname change - record old nickname in member nicknames table if it does not already exist there
  - on member nickname change - record new nickname in member nicknames table
- function that gives previous nicknames for a user


**TO DO**

System
- create database tables
  - vote rounds
  - nominations
  - featured games
  - member friend codes/usernames
  - member reminders
- populate database tables
  - role definitions
  - member/role assignments
  - vote rounds
  - nominations
  - featured games
  - member friend codes/usernames
  - member reminders
- implement "Playing game-of-the-month" [dependent on vote rounds table]
- implement rotation of "playing" between GOTM and NR GOTM [dependent on vote rounds table]
- re-implement admin check from RPGClubBotJS for admin only functions

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
  - on member role removal - remove role in member roles table
  - on event create - automatic creation of live events threads (but not for voting events)
- triggered by bot functions
  - automatic creation of events for voting rounds

Voting
- set up vote round function [admin only]
- nominate game function [one per user per category (GOTM / NR GOTM)]
- display current nominations
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

Admin
- report: how long have newcomers been on the server without participating?
- report: how long have members been with us but not been given regulars?
- report: regulars that do not have longstanding-members role, and how long they have been on the server?
- re-implement channel migration functionality from RPGClubBotJs