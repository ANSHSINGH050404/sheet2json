import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { consumeState, sanitizeRedirectPath } from '#server/auth/oauth-start'
import { getPrisma } from '#server/db/prisma'

/**
 * `state` is the whole CSRF defence for the sign-in flow, so the properties that
 * matter are: it is single-use, it expires, and the stored redirect cannot become
 * an open redirect.
 *
 * Skipped when DATABASE_URL is not set.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

async function seedState(redirectTo: string, ttlMs = 60_000): Promise<string> {
  const state = `state-${crypto.randomUUID()}`
  await getPrisma().oAuthState.create({
    data: {
      state,
      redirectTo,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  })
  return state
}

beforeAll(async () => {
  if (!hasDatabase) return
  await getPrisma().oAuthState.deleteMany({})
})

afterAll(async () => {
  if (!hasDatabase) return
  await getPrisma().oAuthState.deleteMany({})
})

describe('sanitizeRedirectPath', () => {
  it('passes an ordinary same-origin path through', () => {
    expect(sanitizeRedirectPath('/history')).toBe('/history')
    expect(sanitizeRedirectPath('/settings?tab=keys')).toBe(
      '/settings?tab=keys',
    )
  })

  it('refuses a protocol-relative URL, which would leave the site', () => {
    // `//evil.test` is a valid absolute URL with an empty host, and a browser
    // will follow it. This is the classic open-redirect payload.
    expect(sanitizeRedirectPath('//evil.test')).toBe('/')
    expect(sanitizeRedirectPath('//evil.test/steal')).toBe('/')
  })

  it('refuses a backslash, which some browsers treat as a slash', () => {
    expect(sanitizeRedirectPath('/\\evil.test')).toBe('/')
    expect(sanitizeRedirectPath('/path\\..\\..\\evil')).toBe('/')
  })

  it('refuses anything that is not a path', () => {
    expect(sanitizeRedirectPath('https://evil.test')).toBe('/')
    expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/')
    expect(sanitizeRedirectPath('evil.test')).toBe('/')
    expect(sanitizeRedirectPath('')).toBe('/')
  })

  it('refuses a path containing a control character', () => {
    // A newline in a Location header can split the response into a second header.
    expect(sanitizeRedirectPath('/ok\r\nSet-Cookie: a=b')).toBe('/')
    expect(sanitizeRedirectPath('/ok\nLocation: https://evil.test')).toBe('/')
    expect(sanitizeRedirectPath('/ok\tx')).toBe('/')
  })
})

describe.skipIf(!hasDatabase)('consumeState', () => {
  it('returns the stored redirect for a genuine state', async () => {
    const state = await seedState('/settings')
    const consumed = await consumeState(state)

    expect(consumed.redirectTo).toBe('/settings')
  })

  it('is single-use, which is what makes it a real CSRF defence', async () => {
    const state = await seedState('/')

    // First use succeeds.
    expect((await consumeState(state)).redirectTo).toBe('/')

    // A replayed callback - the attack this defends against - must fail.
    await expect(consumeState(state)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    })
  })

  it('rejects an unknown state', async () => {
    await expect(
      consumeState(`never-issued-${crypto.randomUUID()}`),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('rejects an expired state', async () => {
    const state = await seedState('/', -1000)
    await expect(consumeState(state)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    })
  })

  it('rejects a malformed or empty state', async () => {
    for (const value of ['', 'short', 'x'.repeat(300)]) {
      await expect(consumeState(value)).rejects.toMatchObject({
        code: 'OAUTH_STATE_INVALID',
      })
    }
  })

  it('sanitises the stored redirect on the way out, not only on the way in', async () => {
    // Belt and braces: even a row written before the input check existed cannot
    // turn the callback into an open redirect.
    const state = await seedState('//evil.test')
    expect((await consumeState(state)).redirectTo).toBe('/')
  })
})
