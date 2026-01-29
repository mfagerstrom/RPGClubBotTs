# GitHub App Setup for /todo

These steps create a GitHub App, install it on the repo, and configure the bot to use it.

## 1) Create the GitHub App

1. Go to GitHub.
2. Open Settings, then Developer settings, then GitHub Apps.
3. Select New GitHub App.
4. App name: choose any name.
5. Homepage URL: any valid URL is fine.
6. Callback URL: leave empty.
7. Webhook: uncheck Active so no webhook is required.

## 2) Permissions

Set these Repository permissions:
- Issues: Read and write
- Metadata: Read only

No organization permissions are needed.

## 3) Create and download the private key

1. On the app page, scroll to Private keys.
2. Select Generate a private key.
3. Download the .pem file.

## 4) Install the app on the repo

1. From the app page, select Install App.
2. Choose the account that owns the repo.
3. Select Only select repositories.
4. Pick mfagerstrom/RPGClub_GameDB.
5. Complete the installation.

## 5) Gather the IDs

You need two values from GitHub:
- App ID
- Installation ID

Where to find them:
- App ID is shown on the app settings page.
- Installation ID is in the URL of the installation page, for example:

```
/settings/installations/12345678
```

The number is the Installation ID.

## 6) Configure environment variables

Set these in the bot environment:

```
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=12345678
GITHUB_APP_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GITHUB_REPO_OWNER=mfagerstrom
GITHUB_REPO_NAME=RPGClub_GameDB
```

Notes:
- The private key must be a single line string with \n for line breaks.
- Repo owner and name are optional if you use the defaults above.

## 7) Restart the bot and refresh commands

1. Restart the bot so it loads the new env vars.
2. Re-register slash commands if needed.

## 8) Quick sanity checks

- Run `/todo list` to confirm it can read issues.
- Run `/todo create` with a test title and label.
- Run `/todo close` and `/todo reopen` to verify write access.

If you see GitHub auth errors, re-check the App ID, Installation ID, and private key formatting.
