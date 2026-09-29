import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import type { AppError } from '#lib/errors'
import { getPrisma } from '#server/db/prisma'
import {
  createSavedEndpoint,
  deleteSavedEndpoint,
  getSavedEndpoint,
  listSavedEndpoints,
} from '#server/services/endpoints'

// This integration test mutates the database and is opt-in because the normal
// local test environment may point at a database that has not applied this
// feature's migration. CI runs unit tests without a database.
const hasDatabase = Boolean(
  process.env.DATABASE_URL && process.env.RUN_SAVED_ENDPOINT_DB_TESTS === '1',
)
const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`
const CSV = 'name,role\nAnsh,Developer\nRahul,Designer'

function mockFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/csv' },
    })) as unknown as typeof fetch
}

describe.skipIf(!hasDatabase)('saved endpoints', () => {
  let userId: string
  let endpointId: string

  beforeAll(async () => {
    const user = await getPrisma().user.create({
      data: {
        email: `saved-endpoint-${randomUUID()}@example.com`,
      },
      select: { id: true },
    })
    userId = user.id

    const endpoint = await createSavedEndpoint(
      userId,
      {
        name: 'Developer names',
        sourceUrl: SOURCE_URL,
        query: 'where=role%3DDeveloper&select=name',
      },
      { fetchImpl: mockFetch(CSV) },
    )
    endpointId = endpoint.id
  })

  afterAll(async () => {
    if (userId) await getPrisma().user.deleteMany({ where: { id: userId } })
  })

  it('creates a live recipe, lists it, and limits it to its owner', async () => {
    const [listed] = await listSavedEndpoints(userId)
    if (!listed) throw new Error('Expected the saved endpoint to be listed.')

    expect(listed.id).toBe(endpointId)
    expect(listed.name).toBe('Developer names')
    expect(listed.sourceUrl).toBe(SOURCE_URL)
    expect(listed.recipe.select).toEqual(['name'])

    const endpoint = await getSavedEndpoint(endpointId, userId)
    expect(endpoint.recipe).toEqual(listed.recipe)

    let foreignReadCode = ''
    try {
      await getSavedEndpoint(endpointId, 'another-user')
    } catch (error) {
      foreignReadCode = (error as AppError).code
    }
    expect(foreignReadCode).toBe('NOT_FOUND')

    expect(await deleteSavedEndpoint(endpointId, userId)).toBe(true)
    expect(await deleteSavedEndpoint(endpointId, userId)).toBe(false)
  })
})
