# Task Checklist

- Research best practices for Discord.js and DiscordX, along with Typescript, so your coding mindset isn't out of date
- Bootstrap Node.js locally (Node v22) even if system Node is missing: `bash scripts/ensure-local-node.sh`
- Use the repo-local npm wrapper so the bundled Node is picked up: `bash scripts/npm-local.sh <npm args>` (e.g., `bash scripts/npm-local.sh run compile`)
- After code changes, run `npm run lint` and `npm run compile`, fixing all errors reported by each command
- You are disallowed from using npm run build or npm run buildDev
- You are disallowed from using git commands that can result in file changes or losses
- To capture lint output, run `TMPDIR=/tmp bash scripts/npm-local.sh run lint > /tmp/lint.log ; echo $? > /tmp/lint.status` then read `/tmp/lint.log`.
- rules to follow while coding: keep interfaces PascalCase with `I` prefix, type all functions and variable declarations, keep lines <=100 chars, use trailing commas on multiline, semicolons always, avoid multiple blank lines, keep spaced comments.
- Prefer npm/Node commands over Python or other languages for scripting and tooling.
- Check the TODO.md file for development goals.  Don't do these automatically but ask me if I would like you to tackle one of them when you set up a new task context.
- Do not keep making this mistake: [ERROR] (node:30760) Warning: Supplying "ephemeral" for interaction response options is deprecated. Utilize flags instead.