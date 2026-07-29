import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SpanRecord } from '@/glue/tracing/spans'

let exporter: typeof import('./exporter')

beforeEach(async () => {
  vi.resetModules()

  exporter = await import('./exporter')
})

afterEach(() => {
  exporter.stopExporter()
  vi.useRealTimers()
})

function buildRecord(name: string): SpanRecord {
  return {
    attributes: {},
    durationMs: 1,
    events: [],
    id: name.padEnd(16, '0').slice(0, 16),
    kind: 'internal',
    name,
    parentSpanId: null,
    serviceName: 'renderer',
    startedAt: 1700000000000,
    status: 'ok',
    statusMessage: null,
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
  }
}

describe('flushSpans', () => {
  it('sends buffered spans in batches of at most 100', async () => {
    const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })

    for (let index = 0; index < 150; index += 1) {
      exporter.enqueueSpan(buildRecord(`span-${index}`))
    }

    await exporter.flushSpans()

    expect(send).toHaveBeenCalledTimes(2)
    expect((send.mock.calls[0]?.[0] as unknown[]).length).toEqual(100)
    expect((send.mock.calls[1]?.[0] as unknown[]).length).toEqual(50)
  })

  it('keeps spans buffered when the send fails', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue({ insertedCount: 1 })

    exporter.startExporter({ send })
    exporter.enqueueSpan(buildRecord('kept'))

    await exporter.flushSpans()
    await exporter.flushSpans()

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ name: 'kept' })
    ])
  })

  it('drops the oldest spans when the buffer overflows', async () => {
    const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })

    for (let index = 0; index < 1001; index += 1) {
      exporter.enqueueSpan(buildRecord(`span-${index}`))
    }

    await exporter.flushSpans()

    const sent = send.mock.calls.flatMap(
      (call) => call[0] as { name: string }[]
    )

    expect(sent.length).toEqual(1000)
    expect(sent[0]?.name).toEqual('span-1')
  })

  it('does nothing before the exporter is started', async () => {
    exporter.enqueueSpan(buildRecord('early'))

    await exporter.flushSpans()

    const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })
    await exporter.flushSpans()

    expect(send).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'early' })
    ])
  })
})

describe('startExporter', () => {
  it('flushes on an interval', async () => {
    vi.useFakeTimers()

    const send = vi.fn().mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })
    exporter.enqueueSpan(buildRecord('timed'))

    await vi.advanceTimersByTimeAsync(2000)

    expect(send).toHaveBeenCalledTimes(1)
  })
})
