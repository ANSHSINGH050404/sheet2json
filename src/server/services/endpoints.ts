import { AppError } from '#lib/errors'
import { parseEndpointQuery } from '#lib/endpoints'
import type { SavedEndpointSummary } from '#lib/types'
import type { SavedEndpointInput } from '#lib/validation'
import { getPrisma } from '#server/db/prisma'
import { extractSheet } from '#server/services/extraction'

/**
 * Creates a named, live recipe after checking that its source and query work for
 * this account. Only the recipe is stored; each API request fetches fresh rows.
 */
export async function createSavedEndpoint(
  userId: string,
  input: SavedEndpointInput,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<SavedEndpointSummary> {
  const query = parseEndpointQuery(input.query)

  await extractSheet(input.sourceUrl, {
    userId,
    persist: false,
    query,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })

  const record = await getPrisma().savedEndpoint.create({
    data: {
      userId,
      name: input.name,
      sourceUrl: input.sourceUrl,
      query: input.query,
    },
    select: {
      id: true,
      name: true,
      sourceUrl: true,
      query: true,
      createdAt: true,
    },
  })

  return toSummary(record)
}

/** A user's live endpoints, newest first. */
export async function listSavedEndpoints(
  userId: string,
): Promise<SavedEndpointSummary[]> {
  const records = await getPrisma().savedEndpoint.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      sourceUrl: true,
      query: true,
      createdAt: true,
    },
  })

  return records.map(toSummary)
}

/** Reads a saved endpoint only when its owner matches the caller. */
export async function getSavedEndpoint(
  id: string,
  userId: string,
): Promise<SavedEndpointSummary> {
  const record = await getPrisma().savedEndpoint.findFirst({
    where: { id, userId },
    select: {
      id: true,
      name: true,
      sourceUrl: true,
      query: true,
      createdAt: true,
    },
  })

  if (!record) {
    throw new AppError('NOT_FOUND', 'That saved endpoint could not be found.')
  }

  return toSummary(record)
}

/** Deletes one of a user's endpoints. A different owner's row is a no-op. */
export async function deleteSavedEndpoint(
  id: string,
  userId: string,
): Promise<boolean> {
  const { count } = await getPrisma().savedEndpoint.deleteMany({
    where: { id, userId },
  })
  return count > 0
}

function toSummary(record: {
  id: string
  name: string
  sourceUrl: string
  query: string
  createdAt: Date
}): SavedEndpointSummary {
  return {
    id: record.id,
    name: record.name,
    sourceUrl: record.sourceUrl,
    query: record.query,
    createdAt: record.createdAt.toISOString(),
  }
}
