# Sheet2JSON

Turn any Google Sheet into JSON — in the browser, or from your own code over a
REST API.

- **Public sheets** work with no account and no setup.
- **Private sheets** work when you sign in with Google and connect your account.
  They are read with your own read-only permission and stay private to you.
- **A REST API** with your own API key, so a sheet can become an endpoint in a
  script, a webhook or a cron job.

## Getting started

```bash
bun install
bun --bun run dev
```

The app runs on <http://localhost:3000>.

### Database

The app needs PostgreSQL. For Neon, open the Neon Console → Connection Details
and copy the pooled connection string, then:

```bash
cp .env.example .env.local   # then fill in DATABASE_URL
bun run db:migrate
```

Any PostgreSQL 14+ database works.

### Google sign-in (optional)

The app is fully usable without this: public sheets, the web UI and the
anonymous API tier need no account. Sign-in adds private sheets, API keys and
per-user history.

1. In the [Google Cloud Console](https://console.cloud.google.com), create a
   project and enable the **Google Sheets API**.
2. Configure the OAuth consent screen. While it is in "Testing", add your own
   Google account under **Test users** — otherwise sign-in fails with
   `access_denied`.
3. Create credentials → **OAuth client ID** → **Web application**.
4. Add the redirect URI, which must match exactly:
   - development: `http://localhost:3000/auth/google/callback`
   - production: `https://YOUR_DOMAIN/auth/google/callback`
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` in
   `.env.local` (and in your host's environment).

`TOKEN_ENCRYPTION_KEY` encrypts the stored OAuth tokens, so a leaked database is
not enough to read anyone's private spreadsheets. Generate one with:

```bash
openssl rand -base64 32
```

Rotating it invalidates every stored grant; users reconnect from Settings. No
data is lost, only the permission.

The only scope requested is `spreadsheets.readonly` — no Drive access — and
nothing is ever written to a user's spreadsheet.

## Publishing a live table

After extracting a sheet, copy a **live table** link or iframe embed code from
the result. Visitors can search across columns, and the table refreshes from the
sheet every five minutes. The source sheet must be shared as **Anyone with the
link — Viewer**; the published view never uses your sign-in or exposes a private
sheet.

## Sheet assistant

Set `TYPESAFE_API_KEY` in `.env` (or `.env.local`) and your deployment
environment to enable the read-only assistant. It can summarize a sheet, find
rows by values, calculate numeric columns, total sent/received amounts by member,
and prepare CSV or JSON downloads.
Only the user's request and column names are sent to TypeSafe; calculations and
exports use rows already loaded in the app. The assistant never writes to a
sheet or triggers external actions.

## Using the API

Create a key in **Settings** after signing in. Keys are shown once, at creation,
and stored only as a SHA-256 digest.

```bash
curl "https://YOUR_DOMAIN/api/v1/extract?url=https://docs.google.com/spreadsheets/d/SHEET_ID/edit" \
  -H "Authorization: Bearer s2j_your_key"
```

Returns JSON by default; `?format=csv` and `?format=ndjson` return the rows in
those shapes. The full reference is at **`/docs`**, or as JSON from
**`GET /api/v1`**.

Endpoints:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/extract?url=…` | optional | Extract a sheet as JSON, CSV or NDJSON |
| `GET` | `/api/v1/me` | key | Verify a key and read the remaining quota |
| `GET` | `/api/v1/extractions` | key | List the extractions saved from the web UI |
| `GET` | `/api/v1/extractions/{id}` | key | Read one saved extraction |
| `DELETE` | `/api/v1/extractions/{id}` | key | Delete one saved extraction |

Rate limits are per hour, per key and per account, with a smaller per-IP budget
for unauthenticated callers. Every response carries `RateLimit-Limit`,
`RateLimit-Remaining` and `RateLimit-Reset`, so a client can back off before it is
rejected rather than after.

## Architecture

```
src/
  routes/            file-based routes; src/routes/api.* are the REST API
  server/
    auth/            sessions, API keys, OAuth, token crypto
    api/             API middleware: auth, CORS, rate limits, response shapes
    google-sheets/   URL validation, CSV fetch, parsing
    services/        the extraction pipeline and history queries
  components/        presentational React
  lib/               types shared by client and server; no server imports
```

A few decisions worth knowing about, all of which are commented at the point they
matter:

- **Secrets are stored as digests.** Session cookies, API keys and OAuth `state`
  values are only ever stored as SHA-256 hashes, so a database leak yields
  nothing replayable. OAuth *tokens* are different — they must be usable again, so
  they are encrypted with AES-256-GCM under a key held in the environment.
- **The SSRF boundary is the URL validator.** Only spreadsheet ids matching a
  strict allow-list and a numeric `gid` ever reach the network layer, and the
  built URL is re-checked against the expected host.
- **Ownership is checked in SQL, not in the UI.** History queries are scoped by
  `userId`, and a row owned by someone else reads as `404` rather than `403` so
  the error does not confirm that the id exists.
- **Rate-limit counters are in the database.** A limit held in one serverless
  instance's memory is not a limit.
- **The API allows any origin without credentials.** The credential travels in a
  header, and the responses do not opt into credentialed requests, so there is no
  ambient authority for another site to spend.

## Commands

```bash
bun run dev            # start the dev server
bun run build          # production build
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run format         # prettier + eslint --fix
bun test               # unit and integration tests
```

Database tasks:

```bash
bun run db:generate    # regenerate the Prisma client after a schema change
bun run db:migrate     # create and apply a migration
bun run db:deploy      # apply existing migrations (production)
bun run db:studio      # Prisma Studio
bun run db:push        # push the schema without a migration
```

Tests that need a database are skipped when `DATABASE_URL` is unset, so
`bun test` passes on a fresh clone.

## Deploying to Vercel

1. Push the repo to GitHub, GitLab or Bitbucket.
2. In Vercel, choose **Add New > Project** and import it. The framework settings
   are detected automatically; `vercel.json` makes that explicit.
3. Set the production values from `.env.example` under **Settings > Environment
   Variables** — including `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
   `TOKEN_ENCRYPTION_KEY` if you want sign-in.
4. Run `bun run db:deploy` against the production database.

Variables prefixed with `VITE_` are included in the browser bundle. Every secret
this app uses is unprefixed, so it stays server-only.

If you add Google sign-in, add
`https://YOUR_DOMAIN/auth/google/callback` to the OAuth client's redirect URIs.
