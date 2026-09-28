import { AppError } from '#lib/errors'
import { encryptToken } from '#server/auth/secrets'
import {
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_URL,
  GOOGLE_USERINFO_URL,
  requireGoogleCredentials,
} from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * The OAuth leg that comes back from Google: exchange the code, learn who the user
 * is, and store the grant.
 *
 * Nothing here trusts the callback. `state` was already consumed by
 * `consumeState` before any of this runs, which is what established that Google is
 * talking to a redirect this server started.
 */

const AUTH_FAILED_MESSAGE =
  'Google sign-in could not be completed. Please try again.'

export interface CompleteAuthOptions {
  code: string
  /** Absolute origin of this deployment, e.g. `https://sheet2json.app`. */
  origin: string
  /** Injected in tests so the network is never required. */
  fetchImpl?: typeof fetch
}

/** The user as identified by Google, in the shape we store. */
export interface GoogleProfile {
  sub: string
  email: string
  name: string | null
  imageUrl: string | null
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
}

/**
 * Exchanges an authorization code for tokens.
 *
 * `redirect_uri` has to be sent again, byte-identical to the one used to obtain
 * the code; Google rejects the exchange otherwise.
 */
async function exchangeCode(
  code: string,
  origin: string,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = requireGoogleCredentials()

  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: new URL('/auth/google/callback', origin).toString(),
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    // The response body can echo the code back, so it is kept as the error cause
    // and logged server-side rather than returned to the browser.
    throw new AppError(
      'OAUTH_FAILED',
      AUTH_FAILED_MESSAGE,
      await response.text().catch(() => ''),
    )
  }

  return (await response.json()) as TokenResponse
}

/**
 * Reads the profile of the account the token belongs to.
 *
 * `openid email profile` are implied by requesting the Sheets scope alongside
 * them, so no extra scope is needed.
 */
async function fetchProfile(
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<GoogleProfile> {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new AppError('OAUTH_FAILED', AUTH_FAILED_MESSAGE, response.status)
  }

  const body = (await response.json()) as Record<string, unknown>
  const sub = typeof body.sub === 'string' ? body.sub : ''
  const email = typeof body.email === 'string' ? body.email : ''

  // Without both there is nothing to key a user on, and an account that granted
  // the Sheets scope always has both.
  if (sub === '' || email === '') {
    throw new AppError('OAUTH_FAILED', AUTH_FAILED_MESSAGE)
  }

  return {
    sub,
    email,
    name: typeof body.name === 'string' ? body.name : null,
    imageUrl: typeof body.picture === 'string' ? body.picture : null,
  }
}

/**
 * Turns an authorization code into a user plus a stored Google grant.
 *
 * Identity is matched on Google's `sub`, never on email: a Workspace admin can
 * rename an account, and matching the mutable value would silently hand one
 * person another's history.
 *
 * Returns the user's id so the caller can start a session.
 */
export async function completeAuth(
  options: CompleteAuthOptions,
): Promise<{ userId: string; profile: GoogleProfile }> {
  const fetchImpl = options.fetchImpl ?? fetch

  const tokens = await exchangeCode(options.code, options.origin, fetchImpl)
  const accessToken = tokens.access_token
  if (typeof accessToken !== 'string' || accessToken === '') {
    throw new AppError('OAUTH_FAILED', AUTH_FAILED_MESSAGE)
  }

  const profile = await fetchProfile(accessToken, fetchImpl)

  const expiresIn =
    typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600
  const refreshToken =
    typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null
  const scope =
    typeof tokens.scope === 'string' ? tokens.scope : GOOGLE_SCOPES.join(' ')
  const expiresAt = Date.now() + expiresIn * 1000

  const prisma = getPrisma()

  // Identity is Google's stable account id, not the email: a Workspace admin can
  // rename an account, and matching the mutable value would hand one person
  // another's history.
  const existing = await prisma.googleAccount.findUnique({
    where: { sub: profile.sub },
    select: { userId: true },
  })

  const user =
    existing === null
      ? await prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.imageUrl,
            // The grant and the user are created together, so a half-registered
            // account is never left behind.
            googleAccount: { create: { sub: profile.sub } },
          },
          select: { id: true },
        })
      : await prisma.user.update({
          where: { id: existing.userId },
          data: {
            email: profile.email,
            name: profile.name,
            avatarUrl: profile.imageUrl,
          },
          select: { id: true },
        })

  // A re-consent can come back without a refresh token. The previous one is kept
  // rather than overwritten with null, or a long-lived grant would be silently
  // downgraded to one hour.
  const grant = {
    accessTokenEncrypted: encryptToken(accessToken),
    accessTokenExpiresAt: BigInt(expiresAt),
    scope,
  }

  await prisma.googleAccount.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      sub: profile.sub,
      ...grant,
      refreshTokenEncrypted: refreshToken ? encryptToken(refreshToken) : null,
    },
    update: {
      ...grant,
      ...(refreshToken
        ? { refreshTokenEncrypted: encryptToken(refreshToken) }
        : {}),
    },
  })

  return { userId: user.id, profile }
}

/**
 * Disconnects a user's Google grant.
 *
 * Deletes the stored tokens rather than revoking them at Google: the point is
 * that this app stops holding the credential. Revoking it at the source is the
 * user's call, from their Google account settings, which is also the only place
 * that can revoke every client at once.
 */
export async function disconnectGoogle(userId: string): Promise<void> {
  await getPrisma().googleAccount.deleteMany({ where: { userId } })
}
