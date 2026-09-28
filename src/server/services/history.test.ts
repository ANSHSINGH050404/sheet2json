import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { getPrisma } from '#server/db/prisma'
import {
  deleteExtraction,
  extractSheet,
  getExtraction,
  getExtractions,
} from '#server/services/extraction'

/**
 * Prisma/PostgreSQL integration tests.
 *
 * Skipped when DATABASE_URL is not set, so `bun test` still passes on a fresh
 * clone. Every row they create is removed afterwards.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

const created: string[] = []
let userId = ''

function mockFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    })) as unknown as typeof fetch
}

beforeAll(async () => {
  if (!hasDatabase) return
  const user = await getPrisma().user.create({
    data: {
      email: `test-${crypto.randomUUID()}@example.test`,
      googleAccount: { create: { sub: `test-${crypto.randomUUID()}` } },
    },
    select: { id: true },
  })
  userId = user.id
})

afterAll(async () => {
  if (!hasDatabase) return
  // The user cascades to their extractions, so this is the whole cleanup.
  if (userId !== '') {
    await getPrisma().user.deleteMany({ where: { id: userId } })
  }
  await getPrisma().extraction.deleteMany({ where: { id: { in: created } } })
})

describe.skipIf(!hasDatabase)('history queries', () => {
  it("lists a user's own extractions newest first, without the JSON payload", async () => {
    const older = await extractSheet(
      'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit#title=Older',
      { fetchImpl: mockFetch('a,b\n1,2\n3,4'), userId, persist: true },
    )
    const newer = await extractSheet(
      'https://docs.google.com/spreadsheets/d/bbbbbbbbbbbbbbbbbbbbbbbb/edit#title=Newer',
      { fetchImpl: mockFetch('x\n1'), userId, persist: true },
    )
    created.push(older.id, newer.id)

    const list = await getExtractions(userId)

    const olderAt = list.findIndex((item) => item.id === older.id)
    const newerAt = list.findIndex((item) => item.id === newer.id)
    expect(olderAt).toBeGreaterThanOrEqual(0)
    expect(newerAt).toBeGreaterThanOrEqual(0)
    expect(newerAt).toBeLessThan(olderAt)

    const entry = list[newerAt]
    expect(entry?.title).toBe('Newer')
    expect(entry?.rowCount).toBe(1)
    // The list must not carry the payload.
    expect(entry).not.toHaveProperty('data')
  })

  it('reads a single extraction back with its full data', async () => {
    const extraction = await extractSheet(
      'https://docs.google.com/spreadsheets/d/ccccccccccccccccccccccc/edit',
      {
        fetchImpl: mockFetch('name,email\nAnsh,ansh@example.com'),
        userId,
        persist: true,
      },
    )
    created.push(extraction.id)

    const detail = await getExtraction(extraction.id, userId)

    expect(detail.id).toBe(extraction.id)
    expect(detail.data).toEqual([{ name: 'Ansh', email: 'ansh@example.com' }])
    expect(detail.title).toBeNull()
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(getExtraction('does-not-exist', userId)).rejects.toThrow(
      'That extraction could not be found.',
    )
  })

  /**
   * The ownership check. A row belonging to someone else has to read as
   * NOT_FOUND, not FORBIDDEN - otherwise the error itself confirms that the id
   * exists.
   */
  it("does not let one user read another user's extraction", async () => {
    const mine = await extractSheet(
      'https://docs.google.com/spreadsheets/d/dddddddddddddddddddddddd/edit',
      { fetchImpl: mockFetch('a\n1'), userId, persist: true },
    )
    created.push(mine.id)

    const other = await getPrisma().user.create({
      data: {
        email: `other-${crypto.randomUUID()}@example.test`,
        googleAccount: { create: { sub: `other-${crypto.randomUUID()}` } },
      },
      select: { id: true },
    })

    try {
      await expect(getExtraction(mine.id, other.id)).rejects.toThrow(
        'That extraction could not be found.',
      )

      // And the other user's list must not contain it either.
      const theirList = await getExtractions(other.id)
      expect(theirList.find((item) => item.id === mine.id)).toBeUndefined()

      // Nor may they delete it.
      expect(await deleteExtraction(mine.id, other.id)).toBe(false)
    } finally {
      await getPrisma().user.deleteMany({ where: { id: other.id } })
    }
  })

  it('does not persist when persist is false', async () => {
    const result = await extractSheet(
      'https://docs.google.com/spreadsheets/d/eeeeeeeeeeeeeeeeeeeeeeee/edit',
      { fetchImpl: mockFetch('a,b\n1,2'), persist: false },
    )

    expect(result.data).toEqual([{ a: '1', b: '2' }])
    // No id means nothing was written.
    expect(result.id).toBe('')

    const rows = await getPrisma().extraction.count({
      where: { spreadsheetId: 'eeeeeeeeeeeeeeeeeeeeeeee' },
    })
    expect(rows).toBe(0)
  })

  it('resolves the same Prisma client on every call', () => {
    expect(getPrisma()).toBe(getPrisma())
  })
})
