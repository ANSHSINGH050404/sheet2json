# Sheet2JSON

Turn any Google Sheet into JSON — in the browser, or from your own code over a
REST API.

- **Public sheets** work with no account and no setup.
- **Private sheets** work when you sign in with Google and connect your account.
  They are read with your own read-only permission and stay private to you.
- **Saved endpoints** give a sheet and its filters a stable, reusable API URL.
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
environment to enable the read-only assistant. It can summarize a sheet, filter
rows by comparing a column to a value, order and cap the results, look rows up
by value, calculate numeric columns, total sent/received amounts by member, and
prepare CSV or JSON downloads.
Only the user's request and column names are sent to TypeSafe; calculations,
filters and exports use rows already loaded in the app. The assistant never
writes to a sheet or triggers external actions.

### Search by meaning

A literal search matches substrings, which is right for "Status is Pending" and
useless for "which invoices are overdue" — no cell contains the word *overdue*.
When a search comes back empty the assistant offers to rank rows by meaning
instead, which sends up to 100 rows to the AI service, with each cell shortened
before it is sent.

This is the **only** request the app makes that carries sheet values, so it is
opt-in, states what it will send before it sends it, and is hidden entirely when
`TYPESAFE_API_KEY` is not set. Every other assistant call sends the request and
the column names and nothing else.

Filters run through the same `?where=` / `?sort=` / `?limit=` layer the REST API
uses, so "amount over 500" from the assistant and `?where=amount>500` from the
API cannot disagree. Currency symbols, thousands separators and accounting
parentheses are understood, so a column holding `$1,200.50` compares numerically
rather than as text.

## Product analytics

Set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` in `.env` (or `.env.local`) and
your deployment environment. Use the project key and regional host from PostHog
Project Settings. PostHog tracks route categories, extraction completion,
assistant usage, share copies, and downloads. Autocapture and session replay are
disabled; prompts, sheet rows, and sheet URLs are not sent.

## Using the API

Create a key in **Settings** after signing in. Keys are shown once, at creation,
and stored only as a SHA-256 digest.

After extracting a sheet, choose **Save as a live API endpoint** to name the
recipe, preview its column selection and filters, and get a stable URL. The URL
reads current sheet data, applies the saved recipe, and requires one of your API
keys. Reads use the API's short cache. Manage or delete saved endpoints from
**Endpoints**. A stable endpoint ID does not grant access by itself; each request
is scoped to the API key's account.

```bash
curl "https://YOUR_DOMAIN/api/v1/endpoints/ENDPOINT_ID?format=csv" \
  -H "Authorization: Bearer s2j_your_key"
```

```js
const response = await fetch(
  'https://YOUR_DOMAIN/api/v1/endpoints/ENDPOINT_ID',
  { headers: { Authorization: 'Bearer ' + process.env.S2J_KEY } },
)
const data = await response.json()
```

```bash
curl "https://YOUR_DOMAIN/api/v1/extract?url=https://docs.google.com/spreadsheets/d/SHEET_ID/edit" \
  -H "Authorization: Bearer s2j_your_key"
```

Returns JSON by default; `?format=csv` and `?format=ndjson` return the rows in
those shapes. The full reference is at **`/docs`**, or as JSON from
**`GET /api/v1`**.

Rows can be narrowed server-side, so pulling a few rows out of a large tab does
not mean transferring all of them:

```bash
curl "https://YOUR_DOMAIN/api/v1/extract?url=...&where=role=Developer&sort=-amount&limit=5&select=name,amount" \
  -H "Authorization: Bearer s2j_your_key"
```

- **`select`** — comma-separated columns, returned in the order you ask for.
- **`where`** — one filter (`=`, `!=`, `~`, `>`, `>=`, `<`, `<=`). Repeat the
  parameter to AND several together. Numeric columns compare as numbers, not
  strings.
- **`sort`** — columns to order by; a leading `-` sorts descending. Later columns
  break ties.
- **`limit`** — most rows to return, applied after filtering and sorting.

A column that is not in the sheet is a `400`, not an empty result, so a typo is
reported rather than looking like a sheet with no matching rows.

Endpoints:

| Method   | Path                       | Auth     | Purpose                                    |
| -------- | -------------------------- | -------- | ------------------------------------------ |
| `GET`    | `/api/v1/extract?url=…`    | optional | Extract a sheet as JSON, CSV or NDJSON     |
| `GET`    | `/api/v1/endpoints/{id}`   | key      | Fetch a saved live sheet recipe            |
| `GET`    | `/api/v1/me`               | key      | Verify a key and read the remaining quota  |
| `GET`    | `/api/v1/extractions`      | key      | List the extractions saved from the web UI |
| `GET`    | `/api/v1/extractions/{id}` | key      | Read one saved extraction                  |
| `DELETE` | `/api/v1/extractions/{id}` | key      | Delete one saved extraction                |

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
    google-sheets/   URL validation, CSV fetch + retry, parsing, sheet cache
    services/        the extraction pipeline and history queries
  components/        presentational React
  lib/               types shared by client and server; no server imports
```

A few decisions worth knowing about, all of which are commented at the point they
matter:

- **Secrets are stored as digests.** Session cookies, API keys and OAuth `state`
  values are only ever stored as SHA-256 hashes, so a database leak yields
  nothing replayable. OAuth _tokens_ are different — they must be usable again, so
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
- **The parsed-sheet cache is keyed on the reader, not just the sheet.** A sheet
  read with one user's Google grant must never reach another user, so anonymous
  and per-user reads occupy separate entries even for the same public sheet. It
  is in-process rather than shared: a lost instance costs one extra fetch and
  nothing else, which beats a cache that needs invalidating, sizing and paying
  for. Concurrent misses on one sheet share a single upstream request, which is
  what stops fifty open tabs from becoming fifty Google fetches.
- **The data path retries; the LLM path already did.** A 429, a 5xx or a dropped
  connection is retried with exponential backoff, honouring `Retry-After`. A 4xx
  is not retried — a private or deleted sheet stays that way — and neither is a
  timeout, because three 20s attempts would exceed the platform's own budget.
- **The query layer is a grammar, not an evaluator.** `select`, `where`, `sort`
  and `limit` are a small hand-written parser with no `eval` and no nesting: the
  parameters arrive in a URL from an anonymous caller, so the grammar has to be
  small enough to reject without ambiguity. An unknown column is a `400` rather
  than an empty result, because a typo and a sheet with no matching rows look
  identical otherwise.

## Commands

```bash
bun run dev            # start the dev server
bun run build          # production build
bun run typecheck      # tsc --noEmit
bun run lint           # eslint
bun run format         # prettier + eslint --fix
bun run check          # prettier --check
bun run og:image       # regenerate public/og.png, the social preview card
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

### CI

`.github/workflows/ci.yml` has one job, `verify`, and it runs on every push and
every pull request: install, `prisma generate`, `typecheck`, `lint`, `check`
(prettier), `bun test` and `bun run build`.

It needs no database — the integration tests skip themselves when `DATABASE_URL`
is unset, so CI cannot write to production. The generated Prisma client is
committed and ignored by prettier, so a client version bump cannot fail the
formatting gate.

### Deploys and migrations

Deployment is Vercel's job, not CI's: the project is linked to the GitHub repo,
so a merge to `master` deploys to production on its own. The repository needs no
deployment secrets, and CI has nothing to authenticate as.

Migrations are applied by hand, before merging the code that needs them:

```bash
bun run db:deploy
```

That ordering matters, because Vercel deploys from the merge commit and nothing
sequences the two. Running the migration first means new code never reaches
production before the schema it expects.

**Keep every migration backwards compatible.** A migration is applied while the
previous release is still serving traffic, so a schema change that the running
code cannot handle takes the site down. Add the column, deploy the code that
reads it, then drop the old one in a later release.

If you would rather CI own deployment and migrations together, add a `deploy`
job gated on `verify` that runs `prisma migrate deploy` and `vercel deploy --prod`
with four repository secrets under **Settings > Secrets and variables > Actions**:
`DATABASE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Turn off
Vercel's Git integration at the same time, or the same commit deploys twice.

### The social preview card

`public/og.png` is the card every share renders — on X, LinkedIn, Slack, and the
Product Hunt listing. It is generated, not drawn by hand:

```bash
bun run og:image
```

The script in `scripts/generate-og-image.ts` builds the card as SVG and rasterises
it with `sharp` at 4x, downsampled to 1200x630. Change the colours or the preview
rows at the top of that file and re-run. `src/lib/site.ts` holds the absolute URL
and the description, and `src/lib/site.test.ts` checks the things that silently
break a preview: a relative image URL, the wrong aspect ratio, a description that
gets truncated.

## License

MIT — see [LICENSE](LICENSE).

You are welcome to use this, self-host it, or take it apart. If you deploy it
yourself, note that it asks for the `spreadsheets.readonly` scope and nothing
else, so your users' grants stay as narrow as this app's were.
