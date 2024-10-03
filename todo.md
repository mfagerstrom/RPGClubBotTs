**RPGClubBotTs**

**TO DO**

System
- create database tables
  - vote rounds
  - nominations
  - featured games
  - member nicknames
  - member friend codes/usernames
  - member reminders
- populate database tables
  - members
  - role definitions
  - member/role assignments
  - vote rounds
  - nominations
  - featured games
  - member nicknames
  - member friend codes/usernames
  - member reminders
- implement "Playing game-of-the-month" [dependent on vote rounds table]
- implement rotation of "playing" between GOTM and NR GOTM [dependent on vote rounds table]
- re-implement admin check from RPGClubBotJS for admin only functions

Automation
- automatic creation of events for voting rounds
- automatic restoration of roles on re-join 
- nomination reminders 
- automatic vote setup [requires home grown voting mechanism]
- automatic creation of live events threads when an event is made (but not for voting events)
- automatic messaging of reminders via private message to user

Voting
- set up vote round function [admin only]
- nominate game function [one per user per category (GOTM / NR GOTM)]
- display current nominations
- delete nomination function [admin only]
- edit existing nomination [self only with admin only override]
- output vote bot setup strings [admin only]
- replace current vote bot functionality 

Reference
- function that gives previous nicknames for a user
- function that gives friend codes / online usernames for a given user (from a dropdown)
- function that lets you set your own friend codes / online usernames
- function that outputs the full GOTM / NR GOTM history
- function that outputs the GOTM / NR for a given month (by date)
- function that outputs the GOTM / NR for a given round
- function that outputs the round for a given game title
- function that checks if a game has been featured before
  - call this when nominating as a warning?
- function that lets a user set a reminder for themselves

Admin
- report: how long have newcomers been on the server without participating?
- report: how long have members been with us but not been given regulars?
- report: regulars that do not have longstanding-members role, and how long they have been on the server?
- re-implement channel migration functionality from RPGClubBotJs


**DONE**

System
- convert project to TypeScript
- implement HLTB connectivity, previous module used was abandoned and broken
- host bot on Google Cloud
- create SQL server on Google Cloud
- create database tables
  - members
  - role definitions
  - member/role assignments

Automation
- auto-role 'newcomers' on server join
- auto-role 'members' on first message

Reference
- re-implement /hltb command