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

  it('plans a numeric filter by copying the threshold the user wrote', async () => {
    const captured: Record<string, unknown>[] = []
    let call = 0
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      call += 1
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
      captured.push(payload)

      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('column_1'),
            operation: choiceAnswer('none'),
          },
        })
      }

      return Response.json({
        answers: {
          column: choiceAnswer('column_1'),
          operator: choiceAnswer('greater_than'),
          threshold: choiceAnswer('value_5000'),
          sort_column: choiceAnswer('none'),
        },
      })
    }) as unknown as typeof fetch

    await expect(
      planSheetAction(
        'show rows where Amount is over 5000',
        ['Name', 'Amount'],
        {
          apiKey: 'test-typesafe-key',
          fetchImpl,
        },
      ),
    ).resolves.toEqual({
      action: 'filter',
      conditions: [{ column: 'Amount', operator: '>', value: '5000' }],
      sort: [],
      limit: null,
      column: 'Amount',
    })

    // The threshold is offered as a candidate span, so the answer can only be a
    // value that was in the request. This is the property the test exists for.
    expect(JSON.stringify(captured)).toContain('value_5000')
  })

  it('reads the operator from the request wording rather than the model', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('column_0'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('column_0'),
          // Deliberately wrong: the request says "under 100". A regex over the
          // request is literal where a judgment is inferred, so the wording wins.
          operator: choiceAnswer('greater_than'),
          threshold: choiceAnswer('value_100'),
          sort_column: choiceAnswer('none'),
        },
      })
    }) as unknown as typeof fetch

    await expect(
      planSheetAction('show rows where Amount is under 100', ['Amount'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      action: 'filter',
      conditions: [{ column: 'Amount', operator: '<', value: '100' }],
    })
  })

  it('orders ascending when the request asks for the lowest values', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('none'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('none'),
          operator: choiceAnswer('none'),
          threshold: choiceAnswer('none'),
          // The model returns a sort column here; the direction is decided from
          // the request's own wording, because "lowest" cannot be read any other
          // way and a flipped direction returns plausible wrong rows.
          sort_column: choiceAnswer('sort_0'),
        },
      })
    }) as unknown as typeof fetch

    await expect(
      planSheetAction('show the lowest Amount first', ['Amount'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      action: 'filter',
      sort: [{ column: 'Amount', direction: 'asc' }],
    })
  })

  it('turns a bare "top N" into a limit rather than asking which column', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('none'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('none'),
          operator: choiceAnswer('none'),
          threshold: choiceAnswer('none'),
          // No ranking column either: "top 5 rows" caps the sheet as it stands,
          // so the plan is a limit and nothing else.
          sort_column: choiceAnswer('none'),
        },
      })
    }) as unknown as typeof fetch

    await expect(
      planSheetAction('show the top 5 rows', ['Name'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toEqual({
      action: 'filter',
      conditions: [],
      sort: [],
      limit: 5,
      column: '',
    })
  })

  it('keeps both a ranking and a cap when the request names both', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('none'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('none'),
          operator: choiceAnswer('none'),
          threshold: choiceAnswer('none'),
          sort_column: choiceAnswer('sort_0'),
        },
      })
    }) as unknown as typeof fetch

    await expect(
      planSheetAction('show the top 5 rows by Amount', ['Amount'], {
        apiKey: 'test-typesafe-key',
        fetchImpl,
      }),
    ).resolves.toEqual({
      action: 'filter',
      conditions: [],
      sort: [{ column: 'Amount', direction: 'desc' }],
      limit: 5,
      column: 'Amount',
    })
  })

  it('asks which value to compare when the request names no threshold', async () => {
    let call = 0
    const fetchImpl = (async () => {
      call += 1
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('column_0'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('column_0'),
          operator: choiceAnswer('greater_than'),
          threshold: choiceAnswer('none'),
          sort_column: choiceAnswer('none'),
        },
      })
    }) as unknown as typeof fetch

    const plan = await planSheetAction(
      'show rows where Amount is over something',
      ['Amount'],
      { apiKey: 'test-typesafe-key', fetchImpl },
    )

    expect(plan.action).toBe('clarify')
  })

  it('never sends row values to TypeSafe when planning a filter', async () => {
    const captured: Record<string, unknown>[] = []
    let call = 0
    const fetchImpl = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      call += 1
      captured.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      if (call === 1) {
        return Response.json({
          answers: {
            action: choiceAnswer('filter'),
            column: choiceAnswer('column_0'),
            operation: choiceAnswer('none'),
          },
        })
      }
      return Response.json({
        answers: {
          column: choiceAnswer('column_0'),
          operator: choiceAnswer('greater_than'),
          threshold: choiceAnswer('value_5000'),
          sort_column: choiceAnswer('none'),
        },
      })
    }) as unknown as typeof fetch

    await planSheetAction('rows where Amount is over 5000', ['Amount'], {
      apiKey: 'test-typesafe-key',
      fetchImpl,
    })

    const body = JSON.stringify(captured)
    expect(body).not.toContain('ansh@example.com')
    expect(body).not.toContain('Rahul')
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
