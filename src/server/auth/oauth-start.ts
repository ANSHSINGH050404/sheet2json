import { AppError } from '#lib/errors'
import { randomToken } from '#server/auth/crypto'
import {
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_SCOPES,
  OAUTH_STATE_TTL_MINUTES,
  requireGoogleCredentials,
} from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * The OAuth leg that sends the browser to Google.
 *
 * `state` is a random value we store server-side before redirecting and delete
 * when the callback arrives. That is what proves the callback belongs to a
 * redirect this server started - without it, an attacker could feed a victim a
 * callback URL carrying the attacker's own authorization code and silently sign
 * them into the attacker's account.
 */

export interface StartAuthOptions {
  /** Absolute URL to return to after a successful sign-in. */
  redirectTo: string
  /** Injected in tests so the network is never required. */
  fetchImpl?: typeof fetch
}

export interface AuthStartResult {
  /** Where the browser should be sent: Google's consent screen. */
  authorizeUrl: string
  /** The `state` just stored. Echoed back for tests; never sent to the browser. */
  state: string
}

/**
 * The callback URL registered with Google.
 *
 * Derived from the incoming request rather than configured, so the same code
 * works on localhost and in production. Google requires the exact value to match
 * what is registered in the Cloud Console, which is the one piece an operator
 * has to keep in sync.
 */
export function buildRedirectUri(origin: string): string {
  return new URL('/auth/google/callback', origin).toString()
}

/**
 * Which of our own paths a post-sign-in redirect is allowed to target.
 *
 * `state` is attacker-influenceable in a full OAuth flow, so the `redirectTo`
 * stored alongside it is not trusted blindly. Everything is refused except a
 * same-origin path beginning with a single `/` and containing no character that
 * could change how the `Location` header is parsed:
 *
 *   - a leading `//` is a protocol-relative URL, and the browser leaves the site
 *   - a `\` is read as `/` by some browsers, so `/\\evil.test` is also an escape
 *   - CR or LF would let the value inject a second header line
 */
export function sanitizeRedirectPath(value: string): string {
  if (!value.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  if (value.includes('\\')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  return value
}

/**
 * Creates an authorization request and returns the URL to redirect the browser
 * to. Nothing is returned to the client except the Google URL.
 */
export async function startAuth(
  origin: string,
  options: StartAuthOptions,
): Promise<AuthStartResult> {
  void options.fetchImpl
  const { clientId } = requireGoogleCredentials()

  const state = randomToken()
  await getPrisma().oAuthState.create({
    data: {
      state,
      redirectTo: sanitizeRedirectPath(options.redirectTo),
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60 * 1000),
    },
  })

  const url = new URL(GOOGLE_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', buildRedirectUri(origin))
  url.searchParams.set('response_type', 'code')
  // `state` is echoed back on the callback and matched against our stored row.
  url.searchParams.set('state', state)
  // Scopes are space-delimited, and the app asks for one.
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  // Needed for a refresh token, which is what keeps private-sheet access working
  // after the first hour.
  url.searchParams.set('access_type', 'offline')
  // Avoids re-prompting on every sign-in when the user has already consented.
  url.searchParams.set('prompt', 'consent')
  // Incremental grants return only newly granted scopes.
  url.searchParams.set('include_granted_scopes', 'true')

  return { authorizeUrl: url.toString(), state }
}

/** A `state` row that has been proven genuine and has not expired. */
export interface ConsumedState {
  redirectTo: string
}

/**
 * Validates and consumes a `state` value, so the callback can only be used once.
 *
 * Throws `OAUTH_STATE_INVALID` for anything unusable - unknown, expired, or
 * already spent. Never returns null: an unrecognised state is an error, not a
 * branch the caller might forget to handle.
 */
export async function consumeState(state: string): Promise<ConsumedState> {
  if (!state || state.length < 16 || state.length > 256) {
    throw new AppError(
      'OAUTH_STATE_INVALID',
      'This sign-in link has expired. Please try again.',
    )
  }

  // Read, then delete, as two statements. A combined `deleteMany` cannot return
  // the deleted row, and re-reading a surviving row afterwards would open a
  // window for a replayed callback to slip through.
  const found = await getPrisma().oAuthState.findUnique({
    where: { state },
    select: { redirectTo: true, expiresAt: true },
  })

  if (found === null || found.expiresAt.getTime() <= Date.now()) {
    throw new AppError(
      'OAUTH_STATE_INVALID',
      'This sign-in link has expired. Please try again.',
    )
  }

  // Single-use: a second callback carrying the same state finds no row and fails.
  const deleted = await getPrisma().oAuthState.deleteMany({
    where: { state },
  })

  if (deleted.count === 0) {
    throw new AppError(
      'OAUTH_STATE_INVALID',
      'This sign-in link has already been used. Please try again.',
    )
  }

  return { redirectTo: sanitizeRedirectPath(found.redirectTo) }
}

/** Deletes OAuth state rows that were never claimed. Suitable for a cron. */
export async function pruneOAuthStates(): Promise<number> {
  const { count } = await getPrisma().oAuthState.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}
