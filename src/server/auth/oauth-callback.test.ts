import { afterAll, describe, expect, it } from 'bun:test'

import { decryptToken } from '#server/auth/crypto'
import { completeAuth, disconnectGoogle } from '#server/auth/oauth-callback'
import { GOOGLE_TOKEN_URL, GOOGLE_USERINFO_URL } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * The callback leg: exchanging a code, learning who the user is, and storing the
 * grant encrypted.
 *
 * Google is stubbed, so the network is never required. Skipped when DATABASE_URL
 * is not set.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const ORIGIN = 'https://sheet2json.test'

process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'

const created: string[] = []

afterAll(async () => {
  if (!hasDatabase) return
  await getPrisma().user.deleteMany({ where: { id: { in: created } } })
})

interface StubOptions {
  token?: Record<string, unknown>
  tokenStatus?: number
  /** Omit `sub` or `email` to model an unusable profile. */
  userinfo?: Record<string, unknown> | null
  userinfoStatus?: number
}

interface Stub {
  impl: typeof fetch
  seen: { tokenUrl?: string; tokenBody?: string; userinfoAuth?: string }
  sub: string
  email: string
}

/**
 * A Google account unique to this stub.
 *
 * Per-test, because `completeAuth` matches on Google's stable account id: sharing
 * one across tests would make them collide on a single user row, and a test
 * asserting "no user was created" would trip over the previous test's user.
 */
function stubGoogle(options: StubOptions = {}): Stub {
  const sub = `sub-${crypto.randomUUID()}`
  const email = `oauth-${crypto.randomUUID()}@example.test`
  const seen: Stub['seen'] = {}

  const impl = (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith(GOOGLE_TOKEN_URL)) {
      seen.tokenUrl = String(url)
      seen.tokenBody = String(init?.body ?? '')
      if (options.tokenStatus !== undefined && options.tokenStatus !== 200) {
        return new Response('{"error":"invalid_grant"}', {
          status: options.tokenStatus,
        })
      }
      return new Response(
        JSON.stringify(
          options.token ?? {
            access_token: 'ya29.access',
            refresh_token: '1//refresh',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
          },
        ),
        { status: 200 },
      )
    }

    if (String(url).startsWith(GOOGLE_USERINFO_URL)) {
      seen.userinfoAuth = (
        init?.headers as Record<string, string>
      ).authorization
      if (
        options.userinfoStatus !== undefined &&
        options.userinfoStatus !== 200
      ) {
        return new Response('{}', { status: options.userinfoStatus })
      }
      const body =
        options.userinfo === undefined
          ? {
              sub,
              email,
              name: 'Ansh Singh',
              picture: 'https://example.test/a.png',
            }
          : options.userinfo
      return new Response(JSON.stringify(body), { status: 200 })
    }

    throw new Error(`unexpected URL: ${String(url)}`)
  }) as unknown as typeof fetch

  return { impl, seen, sub, email }
}

describe.skipIf(!hasDatabase)('completeAuth', () => {
  it('creates a user and stores the grant encrypted', async () => {
    const { impl, sub } = stubGoogle()

    const { userId, profile } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    expect(profile.sub).toBe(sub)

    const account = await getPrisma().googleAccount.findUnique({
      where: { userId },
    })
    // A database leak must not yield a usable credential.
    expect(decryptToken(account?.accessTokenEncrypted)).toBe('ya29.access')
    expect(decryptToken(account?.refreshTokenEncrypted)).toBe('1//refresh')
    // The BigInt has to be handled, so only the token columns are inspected.
    expect(account?.accessTokenEncrypted).not.toContain('ya29.access')
    expect(account?.refreshTokenEncrypted).not.toContain('1//refresh')
  })

  it('records the expiry as epoch milliseconds', async () => {
    const { impl } = stubGoogle()
    const { userId } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    const account = await getPrisma().googleAccount.findUnique({
      where: { userId },
      select: { accessTokenExpiresAt: true },
    })
    const expiresAt = Number(account?.accessTokenExpiresAt)
    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)
  })

  it('sends the same redirect_uri that the authorize request used', async () => {
    const { impl, seen } = stubGoogle()
    const { userId } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    // Google rejects the exchange if this does not match byte for byte.
    const params = new URLSearchParams(seen.tokenBody ?? '')
    expect(params.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('client_id')).toBe('test-client-id')
    expect(params.get('client_secret')).toBe('test-client-secret')
  })

  it('reads the profile with the new access token', async () => {
    const { impl, seen } = stubGoogle()
    const { userId } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    expect(seen.userinfoAuth).toBe('Bearer ya29.access')
  })

  it('reuses the same user when the same Google account signs in again', async () => {
    const first = stubGoogle()
    const a = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: first.impl,
    })
    created.push(a.userId)

    // Matching on Google's stable id, so a returning user does not accumulate rows.
    const second = stubGoogle({
      userinfo: { sub: first.sub, email: first.email },
    })
    const b = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: second.impl,
    })

    expect(b.userId).toBe(a.userId)
  })

  it('refreshes the stored profile when the user signs in again', async () => {
    const first = stubGoogle()
    const a = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: first.impl,
    })
    created.push(a.userId)

    const second = stubGoogle({
      userinfo: {
        sub: first.sub,
        email: first.email,
        name: 'Ansh S.',
        picture: null,
      },
    })
    await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: second.impl,
    })

    const user = await getPrisma().user.findUnique({ where: { id: a.userId } })
    expect(user?.name).toBe('Ansh S.')
    expect(user?.avatarUrl).toBeNull()
  })

  it('keeps the previous refresh token when a re-consent returns none', async () => {
    const first = stubGoogle()
    const a = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: first.impl,
    })
    created.push(a.userId)

    // Google omits `refresh_token` on a re-consent. Overwriting with null would
    // silently downgrade a long-lived grant to one hour.
    const second = stubGoogle({
      userinfo: { sub: first.sub, email: first.email },
      token: {
        access_token: 'ya29.second',
        expires_in: 3600,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      },
    })
    await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: second.impl,
    })

    const account = await getPrisma().googleAccount.findUnique({
      where: { userId: a.userId },
    })
    expect(decryptToken(account?.accessTokenEncrypted)).toBe('ya29.second')
    expect(decryptToken(account?.refreshTokenEncrypted)).toBe('1//refresh')
  })

  it('stores no refresh token when the first consent omits one', async () => {
    const { impl, sub } = stubGoogle({
      token: { access_token: 'ya29.access', expires_in: 3600 },
    })
    const { userId } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    const account = await getPrisma().googleAccount.findUnique({
      where: { sub },
      select: { refreshTokenEncrypted: true },
    })
    expect(account?.refreshTokenEncrypted).toBeNull()
  })

  it('rejects when the token exchange fails, without creating a user', async () => {
    const { impl, sub } = stubGoogle({ tokenStatus: 400 })

    await expect(
      completeAuth({ code: 'auth-code', origin: ORIGIN, fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' })

    expect(await getPrisma().googleAccount.count({ where: { sub } })).toBe(0)
  })

  it('rejects when the token response has no access token', async () => {
    const { impl } = stubGoogle({ token: { refresh_token: '1//refresh' } })

    await expect(
      completeAuth({ code: 'auth-code', origin: ORIGIN, fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' })
  })

  it('rejects when the profile cannot be read', async () => {
    const { impl } = stubGoogle({ userinfoStatus: 401 })

    await expect(
      completeAuth({ code: 'auth-code', origin: ORIGIN, fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' })
  })

  it('rejects a profile with no subject, which cannot be keyed on', async () => {
    const { impl } = stubGoogle({ userinfo: { email: 'a@example.test' } })

    await expect(
      completeAuth({ code: 'auth-code', origin: ORIGIN, fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' })
  })

  it('rejects a profile with no email', async () => {
    const { impl } = stubGoogle({ userinfo: { sub: 'sub-only' } })

    await expect(
      completeAuth({ code: 'auth-code', origin: ORIGIN, fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'OAUTH_FAILED' })
  })
})

describe.skipIf(!hasDatabase)('disconnectGoogle', () => {
  it('removes the grant, keeping the user', async () => {
    const { impl } = stubGoogle()
    const { userId } = await completeAuth({
      code: 'auth-code',
      origin: ORIGIN,
      fetchImpl: impl,
    })
    created.push(userId)

    await disconnectGoogle(userId)

    // Only the permission goes away. The account, and everything it has done,
    // stays - a user who disconnects is not asking to be deleted.
    expect(await getPrisma().user.count({ where: { id: userId } })).toBe(1)
    expect(await getPrisma().googleAccount.count({ where: { userId } })).toBe(0)
  })

  it('is a no-op for a user with no grant', async () => {
    const user = await getPrisma().user.create({
      data: { email: `disconnect-${crypto.randomUUID()}@example.test` },
      select: { id: true },
    })
    created.push(user.id)

    await disconnectGoogle(user.id)
    expect(await getPrisma().user.count({ where: { id: user.id } })).toBe(1)
  })
})
