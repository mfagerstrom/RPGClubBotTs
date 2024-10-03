**CHANGELOG**

10/3/2024 
- implemented hardcoded discord presence for NR GOTM
- incorporated todo list / changelog into project
- implemented /todo command that outputs the content of todo.md

10/2/2024 
- set up dotenv for private credential handling
- set up initial connection to SQL Server from bot, untested/unused so far
- provisioned a SQL server on Google Cloud
  - created [members, roles, memberRoles] tables
- hosted the bot on Google Cloud

10/1/2024
- implemented auto-roles
  - 'newcomers' on join
  - 'members' on first message

9/24/2024
- tweaked /hltb tip text
- implemented /hltb command
- replicated/rewrote hltb functionality to replace broken imported module from previous version of bot

9/20/2024
- initialized project in Typescript using discordx