import { AppError } from '#lib/errors'
import { decryptToken, encryptToken } from '#server/auth/secrets'
import { GOOGLE_TOKEN_URL, requireGoogleCredentials } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * Access-token lifecycle for reading private sheets.
 *
 * A Google access token lasts about an hour, and a refresh token lasts until the
 * user revokes the grant. This module is the only place either token is used, so
 * there is exactly one answer to "is the token we hold still good?" and one place
 * where a refresh happens.
 */

/** Refresh this long before expiry, so a token never dies mid-request. */
const REFRESH_LEEWAY_MS = 60_000

const REAUTH_MESSAGE =
  'Reconnect your Google account to read this sheet. Your Google permission may have expired.'

/** A usable access token, plus the account it came from. */
export interface GoogleAccess {
  accessToken: string
  userId: string
}

interface RefreshResponse {
  access_token?: unknown
  expires_in?: unknown
  scope?: unknown
  error?: unknown
}

/**
 * A short-lived cache of refreshes.
 *
 * A burst of concurrent API calls for the same user would otherwise all notice
 * the expiry and all refresh at once, which is both slow and a good way to get
 * rate-limited by Google. The in-flight promise is shared per user so only one
 * refresh is ever outstanding.
 *
 * Process-local by nature. That is acceptable: worst case, two serverless
 * instances refresh the same token once each, which Google permits.
 */
const inFlight = new Map<string, Promise<string>>()

/**
 * Returns a valid access token for a user, refreshing it if needed.
 *
 * Throws `GOOGLE_REAUTH_REQUIRED` when the user has no usable grant - no refresh
 * token, or Google refuses to refresh it, which is what revocation looks like.
 */
export async function getGoogleAccess(
  userId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GoogleAccess> {
  const account = await getPrisma().googleAccount.findUnique({
    where: { userId },
    select: {
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      accessTokenExpiresAt: true,
    },
  })

  if (!account) {
    throw new AppError('GOOGLE_REAUTH_REQUIRED', REAUTH_MESSAGE)
  }

  const expiresAt = account.accessTokenExpiresAt
    ? Number(account.accessTokenExpiresAt)
    : 0

  // Still fresh, with leeway: use what we have.
  if (expiresAt > Date.now() + REFRESH_LEEWAY_MS) {
    const accessToken = decryptToken(account.accessTokenEncrypted)
    if (accessToken !== null) return { accessToken, userId }
  }

  const refreshToken = decryptToken(account.refreshTokenEncrypted)
  if (refreshToken === null) {
    throw new AppError('GOOGLE_REAUTH_REQUIRED', REAUTH_MESSAGE)
  }

  const accessToken = await refreshAccessToken(
    userId,
    refreshToken,
    options.fetchImpl,
  )
  return { accessToken, userId }
}

/**
 * Swaps a refresh token for a new access token and stores the result.
 *
 * Concurrent callers for the same user share one in-flight refresh.
 */
async function refreshAccessToken(
  userId: string,
  refreshToken: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const existing = inFlight.get(userId)
  if (existing) return existing

  const pending = doRefresh(userId, refreshToken, fetchImpl ?? fetch).finally(
    () => inFlight.delete(userId),
  )
  inFlight.set(userId, pending)
  return pending
}

async function doRefresh(
  userId: string,
  refreshToken: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const { clientId, clientSecret } = requireGoogleCredentials()

  let response: Response
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
  } catch (cause) {
    throw new AppError('FETCH_FAILED', REAUTH_MESSAGE, cause)
  }

  if (!response.ok) {
    // 400 with `invalid_grant` is the revoked-or-expired case and means the
    // user must re-consent. Other failures (5xx, 429) are transient, so they
    // must not discard a refresh token that is probably still good.
    if (response.status === 400) {
      const body = (await response.json().catch(() => ({}))) as RefreshResponse
      if (body.error === 'invalid_grant') {
        await clearGoogleTokens(userId)
        throw new AppError('GOOGLE_REAUTH_REQUIRED', REAUTH_MESSAGE)
      }
    }
    throw new AppError('FETCH_FAILED', REAUTH_MESSAGE, response.status)
  }

  const body = (await response.json()) as RefreshResponse
  const accessToken = body.access_token
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new AppError('FETCH_FAILED', REAUTH_MESSAGE)
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600
  const scope = typeof body.scope === 'string' ? body.scope : null

  await getPrisma().googleAccount.update({
    where: { userId },
    data: {
      accessTokenEncrypted: encryptToken(accessToken),
      accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      ...(scope ? { scope } : {}),
    },
  })

  return accessToken
}

/**
 * Forgets a user's stored tokens.
 *
 * Called when Google tells us the grant is dead. Without this, every subsequent
 * private-sheet request would retry a refresh Google will keep refusing.
 */
async function clearGoogleTokens(userId: string): Promise<void> {
  try {
    await getPrisma().googleAccount.update({
      where: { userId },
      data: {
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        accessTokenExpiresAt: null,
      },
    })
  } catch (error) {
    console.warn('[google] could not clear revoked tokens', error)
  }
}
