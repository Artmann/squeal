import { beforeEach, describe, expect, it } from 'vitest'

import {
  getTestDatabase,
  resetTestDatabase,
  setupApiMocks
} from '@/test/api-test-helper'

setupApiMocks()

import { spansTable } from '@/database/schema'
import { SpanContext } from '@/glue/tracing/spans'
import {
  getActiveSpanContext,
  runWithContext,
  startSpan,
  withSpan
} from './tracer'

async function selectSpans() {
  const database = getTestDatabase()

  return database.select().from(spansTable)
}

describe('startSpan', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('persists a root span when ended', async () => {
    const span = startSpan('test.operation', {
      attributes: { 'test.key': 'value' },
      kind: 'internal'
    })

    await span.end()

    expect(await selectSpans()).toEqual([
      {
        attributes: '{"test.key":"value"}',
        durationMs: expect.any(Number),
        events: '[]',
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: 'internal',
        name: 'test.operation',
        parentSpanId: null,
        serviceName: 'main',
        startedAt: expect.any(Number),
        status: 'unset',
        statusMessage: null,
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/)
      }
    ])
  })

  it('joins the trace of an explicit parent context', async () => {
    const parent: SpanContext = {
      spanId: '00f067aa0ba902b7',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
    }

    const span = startSpan('child.operation', { parent })

    await span.end()

    const [row] = await selectSpans()

    expect(row?.parentSpanId).toEqual(parent.spanId)
    expect(row?.traceId).toEqual(parent.traceId)
  })

  it('writes only once when ended twice', async () => {
    const span = startSpan('test.operation', {})

    await span.end()
    span.setName('changed')
    await span.end()

    const rows = await selectSpans()

    expect(rows.length).toEqual(1)
    expect(rows[0]?.name).toEqual('test.operation')
  })

  it('truncates long attribute values', async () => {
    const span = startSpan('test.operation', {})

    span.setAttribute('db.statement', 'x'.repeat(3000))
    await span.end()

    const [row] = await selectSpans()
    const attributes = JSON.parse(row?.attributes ?? '{}') as Record<
      string,
      string
    >

    expect(attributes['db.statement']?.length).toEqual(2000)
  })
})

describe('withSpan', () => {
  beforeEach(async () => {
    await resetTestDatabase()
  })

  it('returns the callback result', async () => {
    const result = await withSpan('test.operation', {}, async () => {
      return 42
    })

    expect(result).toEqual(42)
  })

  it('nests child spans under the active context', async () => {
    await withSpan('parent', {}, async () => {
      await withSpan('child', {}, () => Promise.resolve())
    })

    const rows = await selectSpans()
    const parent = rows.find((row) => row.name === 'parent')
    const child = rows.find((row) => row.name === 'child')

    expect(child?.parentSpanId).toEqual(parent?.id)
    expect(child?.traceId).toEqual(parent?.traceId)
  })

  it('marks successful spans ok when no status was set', async () => {
    await withSpan('test.operation', {}, () => Promise.resolve())

    const [row] = await selectSpans()

    expect(row?.status).toEqual('ok')
  })

  it('keeps an explicitly set status', async () => {
    await withSpan('test.operation', {}, async (span) => {
      span.setStatus('error', 'soft failure')
    })

    const [row] = await selectSpans()

    expect(row?.status).toEqual('error')
    expect(row?.statusMessage).toEqual('soft failure')
  })

  it('records exceptions and rethrows', async () => {
    await expect(
      withSpan('failing', {}, async () => {
        throw new Error('Kaboom')
      })
    ).rejects.toThrow('Kaboom')

    const [row] = await selectSpans()

    expect(row?.status).toEqual('error')
    expect(row?.statusMessage).toEqual('Kaboom')

    const events = JSON.parse(row?.events ?? '[]') as unknown[]

    expect(events).toEqual([
      {
        attributes: {
          'exception.message': 'Kaboom',
          'exception.stacktrace': expect.stringContaining('Kaboom'),
          'exception.type': 'Error'
        },
        name: 'exception',
        time: expect.any(Number)
      }
    ])
  })

  it('exposes the span handle to the callback', async () => {
    await withSpan('test.operation', {}, async (span) => {
      span.setAttribute('query.rowCount', 3)
    })

    const [row] = await selectSpans()

    expect(row?.attributes).toEqual('{"query.rowCount":3}')
  })
})

describe('context helpers', () => {
  it('returns undefined outside any span', () => {
    expect(getActiveSpanContext()).toEqual(undefined)
  })

  it('exposes the active context inside withSpan', async () => {
    let observed: SpanContext | undefined

    await withSpan('test.operation', {}, async (span) => {
      observed = getActiveSpanContext()

      expect(observed).toEqual(span.context)
    })

    expect(observed).toBeDefined()
  })

  it('adopts an explicit context across a fire-and-forget boundary', async () => {
    const captured: SpanContext = {
      spanId: '00f067aa0ba902b7',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
    }

    const observed = await new Promise<SpanContext | undefined>((resolve) => {
      void (async () => {
        await Promise.resolve()

        runWithContext(captured, () => {
          resolve(getActiveSpanContext())
        })
      })()
    })

    expect(observed).toEqual(captured)
  })
})
