import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { planSheetAction } from './typesafe'

function choiceAnswer(selected: string, confidence: number = 0.9) {
  return { type: 'choice', choice: selected, confidence }
}

describe('planSheetAction', () => {
  it('maps a natural-language calculation to an allow-listed plan', async () => {
    const captured: {
      requestBody: Record<string, unknown> | null
      authorization: string
    } = { requestBody: null, authorization: '' }

    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      captured.requestBody = JSON.parse(String(init?.body)) as Record<
        string,
        unknown
      >
      captured.authorization =
        new Headers(init?.headers).get('authorization') ?? ''
      return Response.json({
        answers: {
          action: choiceAnswer('aggregate'),
          column: choiceAnswer('column_0'),
          operation: choiceAnswer('sum'),
        },
      })
    }) as unknown as typeof fetch

    const plan = await planSheetAction('sum the Amount column', ['Amount'], {
      apiKey: 'test-typesafe-key',
      fetchImpl,
    })

    expect(plan).toEqual({
      action: 'aggregate',
      column: 'Amount',
      operation: 'sum',
    })
    expect(captured.authorization).toBe('Bearer test-typesafe-key')
    expect(captured.requestBody).toMatchObject({
      model: 'jev-latest',
      state: {
        request: 'sum the Amount column',
        columns: [{ id: 'column_0', name: 'Amount' }],
      },
    })
    expect(JSON.stringify(captured.requestBody)).not.toContain(
      'sheet row value',
    )
  })

  it('returns a clarification when an action choice is uncertain', async () => {
    const fetchImpl = (async () =>
      Response.json({
        answers: {
          action: choiceAnswer('search', 0.4),
          column: choiceAnswer('column_0'),
          operation: choiceAnswer('none'),
        },
      })) as unknown as typeof fetch

    await expect(
      planSheetAction('do something', ['Status'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toEqual({
      action: 'clarify',
      message:
        'I’m not sure what action you want. Try asking me to summarize, search, calculate a column, or prepare a download.',
    })
  })

  it('searches all columns when no individual column is selected', async () => {
    const fetchImpl = (async () =>
      Response.json({
        answers: {
          action: choiceAnswer('search'),
          column: choiceAnswer('none'),
          operation: choiceAnswer('none'),
        },
      })) as unknown as typeof fetch

    await expect(
      planSheetAction('find Pending rows', ['Status'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toEqual({ action: 'search', column: null })
  })

  it('fails clearly when no TypeSafe API key is configured', async () => {
    await expect(
      planSheetAction('summarize this sheet', ['Status'], {
        apiKey: '',
        fetchImpl: (async () => {
          throw new Error('Should not call the network')
        }) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(AppError)
  })
})
