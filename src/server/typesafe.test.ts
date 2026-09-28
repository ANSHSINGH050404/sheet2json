import { describe, expect, it } from 'bun:test'

import { AppError } from '#lib/errors'
import { planSheetAction } from './typesafe'

function choiceAnswer(selected: string, confidence: number = 0.9) {
  return { type: 'choice', choice: selected, confidence }
}

function groupPlannerFetch(
  layout: string,
  roleIndexes: Record<string, number>,
): typeof fetch {
  let call = 0
  return (async () => {
    call += 1
    if (call === 1) {
      return Response.json({
        answers: {
          action: choiceAnswer('group_aggregate'),
          group_layout: choiceAnswer(layout),
        },
      })
    }

    return Response.json({
      answers: Object.fromEntries(
        Object.entries(roleIndexes).map(([role, index]) => [
          role,
          choiceAnswer(`column_${index}`),
        ]),
      ),
    })
  }) as unknown as typeof fetch
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
        'I’m not sure what action you want. Try summarizing, searching, calculating a column, totaling by member, or preparing a download.',
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

  it('plans sent and received totals per member from separate amount columns', async () => {
    const calls: Array<Record<string, unknown>> = []
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      calls.push(payload)

      if (calls.length === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('group_aggregate'),
            group_layout: choiceAnswer('separate_amounts'),
          },
        })
      }

      return Response.json({
        answers: {
          group_column: choiceAnswer('column_0'),
          sent_column: choiceAnswer('column_1'),
          received_column: choiceAnswer('column_2'),
        },
      })
    }) as unknown as typeof fetch

    const prompt =
      'tell me total amount i sent and recived to everyone each member and make table'
    const plan = await planSheetAction(prompt, ['Member', 'Sent', 'Received'], {
      apiKey: 'test-typesafe-key',
      fetchImpl,
    })

    expect(plan).toEqual({
      action: 'group_aggregate',
      layout: 'separate_amounts',
      groupColumn: 'Member',
      sentColumn: 'Sent',
      receivedColumn: 'Received',
    })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls)).not.toContain('sheet row value')
  })

  it('plans grouped totals when a direction column marks sent and received', async () => {
    await expect(
      planSheetAction(
        'total sent and received by member',
        ['Member', 'Amount', 'Direction'],
        {
          apiKey: 'test-typesafe-key',
          fetchImpl: groupPlannerFetch('direction_column', {
            group_column: 0,
            amount_column: 1,
            direction_column: 2,
          }),
        },
      ),
    ).resolves.toEqual({
      action: 'group_aggregate',
      layout: 'direction_column',
      groupColumn: 'Member',
      amountColumn: 'Amount',
      directionColumn: 'Direction',
    })
  })

  it('plans grouped totals from sender and recipient columns', async () => {
    await expect(
      planSheetAction(
        'total what each member sent and received',
        ['From', 'To', 'Amount'],
        {
          apiKey: 'test-typesafe-key',
          fetchImpl: groupPlannerFetch('sender_receiver', {
            sender_column: 0,
            recipient_column: 1,
            amount_column: 2,
          }),
        },
      ),
    ).resolves.toEqual({
      action: 'group_aggregate',
      layout: 'sender_receiver',
      senderColumn: 'From',
      receiverColumn: 'To',
      amountColumn: 'Amount',
    })
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
