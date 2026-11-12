# Bracket Builder

Double-elimination tournament brackets for arm wrestling: weight classes, call
numbers and tables, fouls, undo, Champion of Champions, rankings, team points
and exports.

It runs in two ways from the same code:

| | Offline app (iPhone / iPad) | Server |
| --- | --- | --- |
| Needs internet | No | Yes (or a local network) |
| Where data lives | On the device | PostgreSQL, or a JSON file if no database is set |
| Accounts | None, the device is the organiser | Username + password |
| Live link for spectators | No (big-screen view on the device only) | Yes, with QR code |
| Emailed results | No | Yes, if an email key is set |

## iPhone app (works offline)

Every push to `main` builds an **unsigned IPA** on GitHub's hosted Mac, the same
way as SetMetric. See [INSTALL-IPHONE.md](INSTALL-IPHONE.md) for downloading it
and installing with Sideloadly on Windows.

In the app, tournaments are stored only on the phone. Use **On this device →
Save a backup file** after each event; **Restore from a backup file** puts a
backup back (replacing what is on the device).

## Run it on a computer

Requires Node.js 22 or newer.

```
npm install
npm run dev:app     # the offline app in your browser, no server at all
npm run dev         # the server version at http://localhost:5000
```

`npm run dev` with no `DATABASE_URL` keeps everything in `data/bracket-builder.json`
(created automatically), so no database is needed to try it or to run an event
from one laptop. To use PostgreSQL instead:

```
# PowerShell
$env:DATABASE_URL = "postgres://user:password@host:5432/dbname"
npm run db:push     # creates / updates the tables
npm run dev
```

Production build of the server: `npm run build`, then `npm start`.

| Environment variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Leave unset to store data in a file. |
| `DATA_FILE` | Where the file store is saved when there is no database (default `data/bracket-builder.json`). |
| `SESSION_SECRET` | Secret for login sessions. Set this on a real server. |
| `RESEND_API_KEY` or `SENDGRID_API_KEY`, `EMAIL_FROM` | Email the results when a tournament completes. |
| `PORT` | Port to listen on (default 5000). |

## Checking the bracket engine

```
npm run simulate
```

plays about 1,400 complete tournaments (2–128 athletes, every seeding mode and
play order) and checks that every bracket finishes, that everyone except the
champion loses exactly twice, that undo restores brackets exactly, and that call
numbers and tables never clash. Run it after any change under `shared/`.

## How the code is organised

- `shared/` — everything both versions use, with no server or browser dependencies:
  - `bracket.ts` bracket engine, `stats.ts` rankings / records / team points / call queue
  - `ops.ts` every operation that changes a bracket (start, results, fouls, undo, tables)
  - `api.ts` all tournament endpoints as plain functions (`handle({ method, path, body, userId })`)
  - `storage.ts` the storage contract and the in-memory store; `schema.ts` the PostgreSQL tables
- `server/` — Express: login and sessions, PostgreSQL or file storage, live-update streams, email. `routes.ts` just forwards HTTP requests to `shared/api.ts`.
- `client/src/` — the React app. `lib/backend.ts` sends each request either to the server or, in the offline build (`VITE_BACKEND=local`), to `local/backend.ts`, which runs `shared/api.ts` inside the app and saves to the device (IndexedDB).
- `capacitor.config.json`, `assets/`, `.github/workflows/build-iphone.yml` — the iPhone wrapper and its build.

## Tournament rules in brief

- Standard double elimination: lose once and you drop to the losers bracket, lose twice and you are out. The grand final is reset if the losers-bracket champion wins the first game.
- Seeding: registration order (the spin wheel picks who gets the bye with an odd count), ranked (1 v lowest, byes to the top seeds) or random draw.
- Two fouls in a match is a disqualification.
- Team points per class for places 1–6: 10, 7, 5, 3, 2, 1 (`TEAM_POINTS` in `shared/stats.ts`).
- When every class is finished, the class champions can play a Champion of Champions bracket.
