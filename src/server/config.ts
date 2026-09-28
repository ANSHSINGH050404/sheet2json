/**
 * Server-side configuration and safety limits.
 *
 * Every value can be overridden with an environment variable so the MVP limits
 * can be tuned per deployment without a code change. Defaults are deliberately
 * conservative.
 */

function readInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < min) {
    console.warn(
      `[config] Ignoring invalid ${name}=${JSON.stringify(raw)}, using ${fallback}`,
    )
    return fallback
  }
  return parsed
}

/** Maximum number of data rows stored per extraction. */
export const MAX_ROWS = readInt('MAX_ROWS', 10_000, 1)

/** Maximum size of the CSV document we will read from Google, in bytes. */
export const MAX_RESPONSE_BYTES = readInt(
  'MAX_RESPONSE_BYTES',
  10 * 1024 * 1024,
  1024,
)

/** Time budget for a single request to the Google CSV endpoint. */
export const FETCH_TIMEOUT_MS = readInt('FETCH_TIMEOUT_MS', 20_000, 1_000)

/** How many history rows the list requests. */
export const HISTORY_PAGE_SIZE = readInt('HISTORY_PAGE_SIZE', 50, 1)

/** The Google Sheets public CSV (gviz) endpoint. */
export const GOOGLE_CSV_ENDPOINT =
  'https://docs.google.com/spreadsheets/d/{spreadsheetId}/gviz/tq?tqx=out:csv'

/** Google OAuth endpoints. Hard-coded: they are not deployment-specific. */
export const GOOGLE_AUTHORIZE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_URL =
  'https://openidconnect.googleapis.com/v1/userinfo'

/**
 * The only Google scope we request.
 *
 * Read-only, and only spreadsheets. Not Drive: a Drive scope would let us list
 * every file a user owns, which this app has no use for and which turns a
 * routine sign-in into a request for broad access to someone's Drive.
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
]

/**
 * Whether Google sign-in is configured.
 *
 * The app works without it: public sheets and the web UI need no account, so a
 * deployment can run without OAuth. The UI hides the sign-in affordances when
 * this is false rather than rendering a button that cannot work.
 */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim(),
  )
}

/**
 * The Google OAuth client credentials.
 *
 * Throws when absent, with the missing variable names, because a half-configured
 * flow would otherwise fail much later at the token exchange with an opaque
 * Google error.
 */
export function requireGoogleCredentials(): {
  clientId: string
  clientSecret: string
} {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim()

  if (!clientId || !clientSecret) {
    const missing = [
      ...(clientId ? [] : ['GOOGLE_CLIENT_ID']),
      ...(clientSecret ? [] : ['GOOGLE_CLIENT_SECRET']),
    ]
    throw new Error(
      `Google sign-in is not configured. Missing: ${missing.join(', ')}. See .env.example.`,
    )
  }

  return { clientId, clientSecret }
}

/** How long a signed-in browser session stays valid, in days. */
export const SESSION_TTL_DAYS = readInt('SESSION_TTL_DAYS', 30, 1)

/** Cookie name for the browser session. */
export const SESSION_COOKIE_NAME = 's2j_session'

/**
 * How long an in-flight OAuth request may wait for its callback, in minutes.
 *
 * Long enough to cover a consent screen and a redirect; short enough that a
 * captured `state` row has little value.
 */
export const OAUTH_STATE_TTL_MINUTES = readInt('OAUTH_STATE_TTL_MINUTES', 10, 1)

/** Every API key starts with this, so a leaked key is self-identifying. */
export const API_KEY_PREFIX = 's2j_'

/** Random bytes in an API key. */
export const API_KEY_BYTES = 32

/**
 * Rate limits, per hour.
 *
 * Three tiers, because the credential strength differs: a key is the unit a user
 * manages per project, a user is the unit that can mint more keys, and the IP
 * tier is what stands between an anonymous flood and our upstream quota.
 */
export const RATE_LIMIT_PER_KEY = readInt('RATE_LIMIT_PER_KEY', 1_000, 1)
export const RATE_LIMIT_PER_USER = readInt('RATE_LIMIT_PER_USER', 5_000, 1)
export const RATE_LIMIT_PER_IP = readInt('RATE_LIMIT_PER_IP', 60, 1)

/**
 * How long a successful API extraction may be served from the response cache.
 *
 * The API exists to be polled by scripts, and every miss is a real request to
 * Google on the user's behalf. A short window absorbs polling without ever
 * serving something meaningfully stale. `0` disables it.
 */
export const API_CACHE_TTL_SECONDS = readInt('API_CACHE_TTL_SECONDS', 60, 0)
