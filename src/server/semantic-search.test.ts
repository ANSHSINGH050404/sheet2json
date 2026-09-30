import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import type { SheetRow } from '#lib/types'

import { rankRowsByMeaning, SemanticSearchUnavailable } from './semantic-search'

const ROWS: SheetRow[] = [
  { Name: 'Acme Corp', Status: 'Overdue by 30 days', Amount: '5000' },
  { Name: 'Globex', Status: 'Paid', Amount: '200' },
  { Name: 'Initech', Status: 'Pending', Amount: '900' },
]

/** The single captured request body. Fails the test rather than reading undefined. */
function onlyBody(bodies: string[]): string {
  const body = bodies[0]
  if (body === undefined) throw new Error('No request was captured')
  return body
}

/** The row ids in a captured request body. */
function rowIdsIn(body: string): string[] {
  const payload = JSON.parse(body) as { state: { rows: Array<{ id: string }> } }
  return payload.state.rows.map((row) => row.id)
}

/** The values sent for each row of a captured request body. */
function valuesIn(body: string): string[][] {
  const payload = JSON.parse(body) as {
    state: { rows: Array<{ values: string[] }> }
  }
  return payload.state.rows.map((row) => row.values)
}

/** A fetch that answers every row with the probability for its own index. */
function noulFetch(probabilityFor: (index: number) => number): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const answers = Object.fromEntries(
      rowIdsIn(String(init?.body)).map((id) => [
        id,
        { type: 'noul', noul: probabilityFor(Number(id.slice(4))) },
      ]),
    )
    return Response.json({ answers })
  }) as unknown as typeof fetch
}

describe('rankRowsByMeaning', () => {
  it('ranks rows by relevance rather than by sheet order', async () => {
    // Only the second row is relevant, so it must come back first even though
    // it is not the first row and not a substring match for the question.
    const { scores } = await rankRowsByMeaning(
      'which invoices are overdue?',
      ROWS,
      {
        apiKey: 'test-key',
        fetchImpl: noulFetch((index) => (index === 1 ? 0.95 : 0.05)),
      },
    )

    expect(scores).toEqual([1])
  })

  it('asks one Noul per row in a single request', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      bodies.push(String(init?.body))
      return Response.json({
        answers: {
          row_0: { type: 'noul', noul: 0.9 },
          row_1: { type: 'noul', noul: 0.1 },
          row_2: { type: 'noul', noul: 0.1 },
        },
      })
    }) as unknown as typeof fetch

    await rankRowsByMeaning('anything', ROWS, { apiKey: 'k', fetchImpl })

    // One round trip, not one per row: questions run in parallel, so the cost is
    // the question count rather than the latency of three sequential calls.
    expect(bodies).toHaveLength(1)
    expect(JSON.parse(onlyBody(bodies))).toMatchObject({
      model: 'jev-latest',
      questions: {
        row_0: { type: 'noul' },
        row_1: { type: 'noul' },
        row_2: { type: 'noul' },
      },
    })
  })

  it('drops rows the model is unsure about rather than returning weak matches', async () => {
    // 0.5 is the model being split, not a weak yes, so a 0.5 cut-off would admit
    // exactly the rows the model could not decide about.
    const { scores } = await rankRowsByMeaning('anything', ROWS, {
      apiKey: 'k',
      fetchImpl: noulFetch(() => 0.5),
    })

    expect(scores).toEqual([])
  })

  it('treats an unreadable answer as irrelevant rather than dropping the row', async () => {
    const fetchImpl = (async () =>
      Response.json({
        answers: {
          row_0: { type: 'noul', noul: 0.91 },
          row_1: { type: 'noul' },
          row_2: 'not an answer',
        },
      })) as unknown as typeof fetch

    const { scores } = await rankRowsByMeaning('anything', ROWS, {
      apiKey: 'k',
      fetchImpl,
    })

    expect(scores).toEqual([0])
  })

  it('ignores answer ids that are not row ids', async () => {
    const fetchImpl = (async () =>
      Response.json({
        answers: {
          row_0: { type: 'noul', noul: 0.9 },
          something_else: { type: 'noul', noul: 0.99 },
        },
      })) as unknown as typeof fetch

    const { scores } = await rankRowsByMeaning('anything', ROWS, {
      apiKey: 'k',
      fetchImpl,
    })

    expect(scores).toEqual([0])
  })

  it('fails clearly when every answer is unusable', async () => {
    const fetchImpl = (async () =>
      Response.json({ answers: {} })) as unknown as typeof fetch

    await expect(
      rankRowsByMeaning('anything', ROWS, { apiKey: 'k', fetchImpl }),
    ).rejects.toBeInstanceOf(AppError)
  })

  it('truncates long cell values before they are sent', async () => {
    const bodies: string[] = []
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      bodies.push(String(init?.body))
      return Response.json({ answers: { row_0: { type: 'noul', noul: 0.9 } } })
    }) as unknown as typeof fetch

    const long = 'x'.repeat(4000)
    await rankRowsByMeaning('anything', [{ Note: long }], {
      apiKey: 'k',
      fetchImpl,
    })

    // This is the one request in the app that carries sheet values, so the bound
    // on what leaves the browser is asserted rather than assumed. The sent cell
    // must be the truncated span, not the original 4,000 characters.
    const [sentValue] = valuesIn(onlyBody(bodies))[0] ?? []
    expect(sentValue).toHaveLength(121)
    expect(sentValue?.endsWith('…')).toBe(true)
    expect(onlyBody(bodies).length).toBeLessThan(long.length)
  })

  it('prefers the most varied columns when a row has more cells than the cap', async () => {
    const row: SheetRow = {}
    for (let index = 0; index < 40; index += 1) {
      row[`Column ${index}`] = index === 0 ? 'only value' : `value ${index}`
    }

    const bodies: string[] = []
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      bodies.push(String(init?.body))
      return Response.json({ answers: { row_0: { type: 'noul', noul: 0.9 } } })
    }) as unknown as typeof fetch

    await rankRowsByMeaning('anything', [row], { apiKey: 'k', fetchImpl })

    expect(valuesIn(onlyBody(bodies))[0]?.length ?? 0).toBeLessThanOrEqual(12)
  })

  it('reports an unconfigured service distinctly from a failed one', async () => {
    // The UI hides the affordance when there is no key, so this has to be
    // distinguishable from a service error rather than reported as one.
    await expect(
      rankRowsByMeaning('anything', ROWS, { apiKey: '' }),
    ).rejects.toBeInstanceOf(SemanticSearchUnavailable)
  })

  it('returns nothing for an empty sheet without calling the service', async () => {
    const { scores } = await rankRowsByMeaning('anything', [], {
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new Error('Should not call the network')
      }) as unknown as typeof fetch,
    })

    expect(scores).toEqual([])
  })
})
