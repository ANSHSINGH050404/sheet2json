import { afterAll, describe, expect, it } from 'bun:test'

import { getPrisma } from '#server/db/prisma'
import { extractSheet, getExtraction, getExtractions } from '#server/services/extraction'

/**
 * Prisma/PostgreSQL integration tests.
 *
 * These are skipped when DATABASE_URL is not set, so `bun test` still passes on a
 * fresh clone. They clean up every row they create.
 */
const hasDatabase = Boolean(process.env.DATABASE_URL)

const created: string[] = []

function mockFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } })) as unknown as typeof fetch
}

afterAll(async () => {
  if (created.length === 0 || !hasDatabase) return
  await getPrisma().extraction.deleteMany({ where: { id: { in: created } } })
})

describe.skipIf(!hasDatabase)('history queries', () => {
  it('lists extractions newest first without leaking the JSON payload', async () => {
    const older = await extractSheet(
      'https://docs.google.com/spreadsheets/d/aaaaaaaaaaaaaaaaaaaaaaaa/edit#title=Older',
      { fetchImpl: mockFetch('a,b\n1,2\n3,4') },
    )
    const newer = await extractSheet(
      'https://docs.google.com/spreadsheets/d/bbbbbbbbbbbbbbbbbbbbbbbb/edit#title=Newer',
      { fetchImpl: mockFetch('x\n1') },
    )
    created.push(older.id, newer.id)

    const list = await getExtractions()

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
    const created1 = await extractSheet(
      'https://docs.google.com/spreadsheets/d/ccccccccccccccccccccccc/edit',
      { fetchImpl: mockFetch('name,email\nAnsh,ansh@example.com') },
    )
    created.push(created1.id)

    const detail = await getExtraction(created1.id)

    expect(detail.id).toBe(created1.id)
    expect(detail.data).toEqual([{ name: 'Ansh', email: 'ansh@example.com' }])
    expect(detail.title).toBeNull()
  })

  it('throws NOT_FOUND for an unknown id', async () => {
    await expect(getExtraction('does-not-exist')).rejects.toThrow(
      'That extraction could not be found.',
    )
  })

  it('resolves the same Prisma client on every call', () => {
    expect(getPrisma()).toBe(getPrisma())
  })
})
