import { beforeEach, describe, expect, it, vi } from 'vitest'

let exporter: typeof import('./exporter')
let tracer: typeof import('./tracer')

beforeEach(async () => {
  vi.resetModules()

  exporter = await import('./exporter')
  tracer = await import('./tracer')
})

async function flushedSpans() {
  const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

  exporter.startExporter({ send })
  await exporter.flushSpans()
  exporter.stopExporter()

  return send.mock.calls.flatMap((call) => call[0] as unknown[])
}

describe('startSpan', () => {
  it('exports an ended span with renderer metadata', async () => {
    const span = tracer.startSpan('query.run', {
      attributes: { 'query.id': 'query-1' },
      kind: 'internal'
    })

    span.end()

    expect(await flushedSpans()).toEqual([
      {
        attributes: { 'query.id': 'query-1' },
        durationMs: expect.any(Number),
        events: [],
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: 'internal',
        name: 'query.run',
        parentSpanId: null,
        serviceName: 'renderer',
        startedAt: expect.any(Number),
        status: 'unset',
        statusMessage: null,
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/)
      }
    ])
  })

  it('joins the trace of an explicit parent', async () => {
    const parent = tracer.startSpan('parent', {})
    const child = tracer.startSpan('child', { parent: parent.context })

    child.end()
    parent.end()

    const spans = (await flushedSpans()) as {
      name: string
      parentSpanId: string | null
      traceId: string
    }[]
    const childRecord = spans.find((span) => span.name === 'child')

    expect(childRecord?.parentSpanId).toEqual(parent.context.spanId)
    expect(childRecord?.traceId).toEqual(parent.context.traceId)
  })

  it('exports only once when ended twice', async () => {
    const span = tracer.startSpan('once', {})

    span.end()
    span.end()

    expect((await flushedSpans()).length).toEqual(1)
  })

  it('records exceptions', async () => {
    const span = tracer.startSpan('failing', {})

    span.recordException(new Error('Kaboom'))
    span.end()

    const [record] = (await flushedSpans()) as {
      events: { attributes?: Record<string, unknown>; name: string }[]
      status: string
      statusMessage: string | null
    }[]

    expect(record?.status).toEqual('error')
    expect(record?.statusMessage).toEqual('Kaboom')
    expect(record?.events[0]?.name).toEqual('exception')
  })
})
