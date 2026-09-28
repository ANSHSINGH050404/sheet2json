import { afterAll, describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { decryptToken, encryptToken } from '#server/auth/crypto'
import { getGoogleAccess } from '#server/auth/google-tokens'
import { GOOGLE_TOKEN_URL } from '#server/config'
import { getPrisma } from '#server/db/prisma'

/**
 * The token lifecycle is what keeps private-sheet access working after the first
 * hour, and what makes a revoked grant stop being retried forever.
 *
 * Skipped when DATABASE_URL is not set.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

/**
 * Runs `run` with the given environment variables set, then restores them.
 *
 * Awaits the result before restoring, because these code paths read the
 * environment *during* the request: restoring synchronously would put the
 * variables back while the promise was still in flight, and the test would then
 * be measuring a misconfigured deployment rather than the behaviour it means to.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

const configuredEnv = {
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  TOKEN_ENCRYPTION_KEY: ENCRYPTION_KEY,
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'NO_THROW'
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT_APP_ERROR'
  }
}

/** A user with a grant, removed on cleanup. */
async function userWithGrant(grant: {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}): Promise<string> {
  const user = await getPrisma().user.create({
    data: {
      email: `tokens-${crypto.randomUUID()}@example.test`,
      googleAccount: {
        create: {
          sub: `tokens-${crypto.randomUUID()}`,
          accessTokenEncrypted:
            grant.accessToken === undefined
              ? null
              : encryptToken(grant.accessToken),
          refreshTokenEncrypted:
            grant.refreshToken === undefined
              ? null
              : encryptToken(grant.refreshToken),
          accessTokenExpiresAt:
            grant.expiresAt === undefined ? null : BigInt(grant.expiresAt),
        },
      },
    },
    select: { id: true },
  })
  return user.id
}

const created: string[] = []

/**
 * The test key is set for the whole file, not per test.
 *
 * Seeding a grant means encrypting one, and that has to happen before the
 * per-test `withEnv` scope opens. Doing it per test would mean creating the user
 * inside the scope and tracking ids in two places.
 */
process.env.TOKEN_ENCRYPTION_KEY = ENCRYPTION_KEY

afterAll(async () => {
  await getPrisma().user.deleteMany({ where: { id: { in: created } } })
})

async function makeUser(grant: Parameters<typeof userWithGrant>[0]) {
  const id = await userWithGrant(grant)
  created.push(id)
  return id
}

describe.skipIf(!hasDatabase)('getGoogleAccess', () => {
  it('returns a stored access token that is still fresh', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.fresh',
      refreshToken: '1//refresh',
      expiresAt: Date.now() + 3_600_000,
    })

    const access = await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: neverCalled() }),
    )

    expect(access.accessToken).toBe('ya29.fresh')
    expect(access.userId).toBe(userId)
  })

  it('refreshes when the token has expired', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    const access = await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, {
        fetchImpl: respondWithToken('ya29.renewed', 3600),
      }),
    )

    expect(access.accessToken).toBe('ya29.renewed')
  })

  it('stores the refreshed token, so the next call does not refresh again', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    let calls = 0
    const countingFetch = (async () => {
      calls += 1
      return new Response(
        JSON.stringify({ access_token: 'ya29.renewed', expires_in: 3600 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: countingFetch }),
    )
    expect(calls).toBe(1)

    // The stored expiry is now in the future, so this must not hit the network.
    await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: neverCalled() }),
    )

    const row = await getPrisma().googleAccount.findUnique({
      where: { userId },
      select: { accessTokenEncrypted: true },
    })
    expect(decryptToken(row?.accessTokenEncrypted)).toBe('ya29.renewed')
  })

  it('refreshes before the token actually expires, not after', async () => {
    // 30 seconds left is inside the leeway, so a request started now cannot have
    // the token die mid-flight.
    const userId = await makeUser({
      accessToken: 'ya29.almost-expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() + 30_000,
    })

    const access = await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, {
        fetchImpl: respondWithToken('ya29.renewed', 3600),
      }),
    )

    expect(access.accessToken).toBe('ya29.renewed')
  })

  it('sends the refresh token and both client credentials', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//the-refresh-token',
      expiresAt: Date.now() - 1000,
    })

    let body = ''
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body ?? '')
      return new Response(
        JSON.stringify({ access_token: 'ya29.renewed', expires_in: 3600 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: capturingFetch }),
    )

    const params = new URLSearchParams(body)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('1//the-refresh-token')
    // Google requires both for a confidential client.
    expect(params.get('client_id')).toBe(CLIENT_ID)
    expect(params.get('client_secret')).toBe(CLIENT_SECRET)
  })

  it('reuses one in-flight refresh for concurrent callers', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    let calls = 0
    const slowFetch = (async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return new Response(
        JSON.stringify({ access_token: 'ya29.renewed', expires_in: 3600 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    const results = await withEnv(configuredEnv, () =>
      Promise.all([
        getGoogleAccess(userId, { fetchImpl: slowFetch }),
        getGoogleAccess(userId, { fetchImpl: slowFetch }),
        getGoogleAccess(userId, { fetchImpl: slowFetch }),
      ]),
    )

    // A burst must not turn into three token requests, which is both slow and an
    // easy way to get rate-limited by Google.
    expect(calls).toBe(1)
    expect(results.every((r) => r.accessToken === 'ya29.renewed')).toBe(true)
  })

  it('requires re-auth when the user has no grant at all', async () => {
    const userId = await makeUser({})

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: neverCalled() })),
      ),
    ).toBe('GOOGLE_REAUTH_REQUIRED')
  })

  it('requires re-auth when there is no refresh token to fall back on', async () => {
    const userId = await makeUser({ accessToken: 'ya29.expired' })

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: neverCalled() })),
      ),
    ).toBe('GOOGLE_REAUTH_REQUIRED')
  })

  it('refreshes when the stored access token cannot be decrypted', async () => {
    // A rotated encryption key leaves undecryptable values behind. The refresh
    // token is still readable, so the right move is to refresh rather than send
    // the user round the consent screen for nothing.
    const user = await getPrisma().user.create({
      data: {
        email: `undecryptable-access-${crypto.randomUUID()}@example.test`,
        googleAccount: {
          create: {
            sub: `undecryptable-access-${crypto.randomUUID()}`,
            accessTokenEncrypted: 'v1.a.b.c',
            refreshTokenEncrypted: encryptToken('1//refresh'),
            accessTokenExpiresAt: BigInt(Date.now() - 1000),
          },
        },
      },
      select: { id: true },
    })
    created.push(user.id)

    const access = await withEnv(configuredEnv, () =>
      getGoogleAccess(user.id, {
        fetchImpl: respondWithToken('ya29.renewed', 3600),
      }),
    )

    expect(access.accessToken).toBe('ya29.renewed')
  })

  it('requires re-auth when the refresh token cannot be decrypted', async () => {
    // Same rotated key, but now the one credential that cannot be replaced is
    // gone. That must read as "no grant" rather than crash the request.
    const user = await getPrisma().user.create({
      data: {
        email: `undecryptable-refresh-${crypto.randomUUID()}@example.test`,
        googleAccount: {
          create: {
            sub: `undecryptable-refresh-${crypto.randomUUID()}`,
            accessTokenEncrypted: encryptToken('ya29.expired'),
            refreshTokenEncrypted: 'v1.a.b.c',
            accessTokenExpiresAt: BigInt(Date.now() - 1000),
          },
        },
      },
      select: { id: true },
    })
    created.push(user.id)

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(user.id, { fetchImpl: neverCalled() })),
      ),
    ).toBe('GOOGLE_REAUTH_REQUIRED')
  })

  it('clears the stored tokens when Google says the grant is revoked', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    const revoked = (async () =>
      new Response(JSON.stringify({ error: 'invalid_grant' }), {
        status: 400,
      })) as unknown as typeof fetch

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: revoked })),
      ),
    ).toBe('GOOGLE_REAUTH_REQUIRED')

    // The dead token is forgotten, so the next request does not retry a refresh
    // Google will keep refusing.
    const row = await getPrisma().googleAccount.findUnique({
      where: { userId },
      select: { refreshTokenEncrypted: true, accessTokenEncrypted: true },
    })
    expect(row?.refreshTokenEncrypted).toBeNull()
    expect(row?.accessTokenEncrypted).toBeNull()
  })

  it('keeps a refresh token when Google fails transiently', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    // A 500 is our problem, not the user's. Discarding their grant over it would
    // force a pointless re-consent.
    const unavailable = (async () =>
      new Response('upstream error', {
        status: 500,
      })) as unknown as typeof fetch

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: unavailable })),
      ),
    ).toBe('FETCH_FAILED')

    const row = await getPrisma().googleAccount.findUnique({
      where: { userId },
      select: { refreshTokenEncrypted: true },
    })
    expect(row?.refreshTokenEncrypted).not.toBeNull()
  })

  it('treats a 400 that is not invalid_grant as transient', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    const otherError = (async () =>
      new Response(JSON.stringify({ error: 'invalid_client' }), {
        status: 400,
      })) as unknown as typeof fetch

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: otherError })),
      ),
    ).toBe('FETCH_FAILED')
  })

  it('does not discard a token when the network itself fails', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    const offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    expect(
      await withEnv(configuredEnv, () =>
        code(getGoogleAccess(userId, { fetchImpl: offline })),
      ),
    ).toBe('FETCH_FAILED')

    const row = await getPrisma().googleAccount.findUnique({
      where: { userId },
      select: { refreshTokenEncrypted: true },
    })
    expect(row?.refreshTokenEncrypted).not.toBeNull()
  })

  it('posts to the Google token endpoint', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//refresh',
      expiresAt: Date.now() - 1000,
    })

    let seen = ''
    const capturingFetch = (async (url: string) => {
      seen = String(url)
      return new Response(
        JSON.stringify({ access_token: 'ya29.renewed', expires_in: 3600 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: capturingFetch }),
    )

    expect(seen).toBe(GOOGLE_TOKEN_URL)
  })

  it('never puts the refresh token in a URL', async () => {
    const userId = await makeUser({
      accessToken: 'ya29.expired',
      refreshToken: '1//super-secret',
      expiresAt: Date.now() - 1000,
    })

    let seen = ''
    const capturingFetch = (async (url: string) => {
      seen = String(url)
      return new Response(
        JSON.stringify({ access_token: 'ya29.renewed', expires_in: 3600 }),
        { status: 200 },
      )
    }) as unknown as typeof fetch

    await withEnv(configuredEnv, () =>
      getGoogleAccess(userId, { fetchImpl: capturingFetch }),
    )

    // URLs are the part of a request most likely to be logged or forwarded.
    expect(seen).not.toContain('super-secret')
  })
})

/** A fetch that must never be called. */
function neverCalled(): typeof fetch {
  return (async () => {
    throw new Error('the network should not have been used')
  }) as unknown as typeof fetch
}

function respondWithToken(
  accessToken: string,
  expiresIn: number,
): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({ access_token: accessToken, expires_in: expiresIn }),
      {
        status: 200,
      },
    )) as unknown as typeof fetch
}
