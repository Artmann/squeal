import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canceledQueryMessage } from '@/glue/queries'

let exporter: typeof import('./exporter')
let queryTraces: typeof import('./query-traces')

beforeEach(async () => {
  vi.resetModules()

  exporter = await import('./exporter')
  queryTraces = await import('./query-traces')
})

const query = {
  content: 'SELECT 1',
  databaseId: 'database-1',
  id: 'query-1',
  worksheetId: 'worksheet-1'
}

async function flushedSpans() {
  const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

  exporter.startExporter({ send })
  await exporter.flushSpans()
  exporter.stopExporter()

  return send.mock.calls.flatMap(
    (call) =>
      call[0] as {
        attributes: Record<string, unknown>
        events: { attributes?: Record<string, unknown>; name: string }[]
        name: string
        status: string
        statusMessage: string | null
      }[]
  )
}

describe('query traces', () => {
  it('exposes the root span context while the query runs', () => {
    queryTraces.startQueryTrace(query)

    expect(queryTraces.getQueryTraceParent('query-1')).toEqual({
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/)
    })
  })

  it('returns undefined for unknown queries', () => {
    expect(queryTraces.getQueryTraceParent('unknown')).toEqual(undefined)
  })

  it('does not replace the span when started twice', () => {
    queryTraces.startQueryTrace(query)

    const first = queryTraces.getQueryTraceParent('query-1')

    queryTraces.startQueryTrace(query)

    expect(queryTraces.getQueryTraceParent('query-1')).toEqual(first)
  })

  it('finishes a successful query as an ok root span', async () => {
    queryTraces.startQueryTrace(query)
    queryTraces.finishQueryTrace({ error: null, id: 'query-1' })

    const [span] = await flushedSpans()

    expect(span?.name).toEqual('query.run')
    expect(span?.status).toEqual('ok')
    expect(span?.attributes).toEqual({
      'database.id': 'database-1',
      'db.statement': 'SELECT 1',
      'query.id': 'query-1',
      'worksheet.id': 'worksheet-1'
    })
    expect(span?.events).toEqual([
      {
        attributes: { 'query.success': true },
        name: 'query.finished',
        time: expect.any(Number)
      }
    ])

    expect(queryTraces.getQueryTraceParent('query-1')).toEqual(undefined)
  })

  it('finishes a failed query as an error root span', async () => {
    queryTraces.startQueryTrace(query)
    queryTraces.finishQueryTrace({
      error: 'relation "nope" does not exist',
      id: 'query-1'
    })

    const [span] = await flushedSpans()

    expect(span?.status).toEqual('error')
    expect(span?.statusMessage).toEqual('relation "nope" does not exist')
  })

  it('finishes a canceled query as ok with a cancel event', async () => {
    queryTraces.startQueryTrace(query)
    queryTraces.finishQueryTrace({
      error: canceledQueryMessage,
      id: 'query-1'
    })

    const [span] = await flushedSpans()

    expect(span?.status).toEqual('ok')
    expect(span?.events.map((event) => event.name)).toEqual([
      'query.canceled',
      'query.finished'
    ])
  })

  it('ignores a second finish for the same query', async () => {
    queryTraces.startQueryTrace(query)
    queryTraces.finishQueryTrace({ error: null, id: 'query-1' })
    queryTraces.finishQueryTrace({ error: 'late', id: 'query-1' })

    const spans = await flushedSpans()

    expect(spans.length).toEqual(1)
    expect(spans[0]?.status).toEqual('ok')
  })

  it('ignores finishing a query that was never started', () => {
    expect(() =>
      queryTraces.finishQueryTrace({ error: null, id: 'unknown' })
    ).not.toThrow()
  })
})
