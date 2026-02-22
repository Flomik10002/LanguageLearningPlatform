# SQLite and token access

## Run server
Start the API + static server:

`npm start`

Default URL: `http://localhost:3000`

## Token management
Add a token you issued to a user:

`npm run token:add -- <token> [label]`

Create a random token:

`npm run token:create -- [label]`

List tokens:

`npm run token:list`

Revoke token:

`npm run token:revoke -- <token>`

Activate token again:

`npm run token:activate -- <token>`

Users cannot access app content without a valid active token. Token is stored in browser `localStorage` key `ll_access_token`.
Lessons and attempts are isolated per token; there is no shared lesson library between users.

## Import a localStorage export
1. In the app, click `Export all` and save the JSON file.
2. Run import:
   `npm run db:import -- /path/to/flomik-labs-backup-XXXX.json`

This is a legacy global import and is not used by token-based app screens.
Database file: `server/data/flomik-labs.sqlite` (override with `LL_DB_PATH`).

## Bind backup to a specific token
If you want backup data to belong to one specific user token:

1. Add/create token first.
2. Import lessons + attempts for this token:
   `npm run db:import-token -- <token> /path/to/flomik-labs-backup-XXXX.json`

This writes to `user_lessons` and `user_attempts` for that token. When user signs in, they see only their own library/history.

## Lesson creation in UI
1. Sign in with token.
2. Click `Copy LESSON_FORMAT.md`.
3. Send that template to AI with your lesson topic and ask for valid JSON output.
4. Paste returned JSON into the lesson text field on the Library screen.

## Memory-only lessons mode
Open app with `?memory=1` to keep lesson files in memory only (no lesson writes to token DB).
Attempts are still synced to SQLite by token.
