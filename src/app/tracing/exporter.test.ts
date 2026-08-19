import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

import { SpanRecord } from '@/glue/tracing/spans'

let exporter: typeof import('./exporter')

// Silenced for every test, not only the two that assert on it. The failure
// path warns, so a test that merely exercises it would otherwise print a real
// outage line during a green run -- and a spy restored at the end of a test
// body is not restored when an assertion above it throws, which leaks the
// previous test's recorded calls into the next one.
let warn: MockInstance<typeof console.warn>

beforeEach(async () => {
  vi.resetModules()

  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  exporter = await import('./exporter')
})

afterEach(() => {
  exporter.stopExporter()
  warn.mockRestore()
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

  // Any user action ends a traced span, so enqueueSpan runs during the POST
  // the exporter is awaiting. The exporter must therefore own its batch from
  // the moment it takes it -- identifying it by position in a buffer that the
  // overflow trim can shorten underneath it loses spans that were never sent,
  // which is silent loss beyond the documented drop-oldest policy.
  it('keeps the spans enqueued while a batch was in flight', async () => {
    let releaseTheFirstBatch: () => void = () => undefined

    const send = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseTheFirstBatch = () => resolve({ insertedCount: 100 })
        })
      )
      .mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })

    for (let index = 0; index < 100; index += 1) {
      exporter.enqueueSpan(buildRecord(`early-${index}`))
    }

    const flushed = exporter.flushSpans()

    // Enough to refill the buffer to capacity while the first batch is still
    // unacknowledged, which is the only window the loss can happen in.
    for (let index = 0; index < 1000; index += 1) {
      exporter.enqueueSpan(buildRecord(`late-${index}`))
    }

    releaseTheFirstBatch()

    await flushed

    const sent = send.mock.calls.flatMap(
      (call) => call[0] as { name: string }[]
    )
    const sentNames = new Set(sent.map((span) => span.name))
    const neverSent = Array.from(
      { length: 1000 },
      (_unused, index) => `late-${index}`
    ).filter((name) => !sentNames.has(name))

    expect({ neverSent, sentCount: sent.length }).toEqual({
      neverSent: [],
      sentCount: 1100
    })
  })

  it('drops the oldest spans overall when a failed batch comes back full', async () => {
    let rejectTheFirstBatch: () => void = () => undefined

    const send = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectTheFirstBatch = () => reject(new Error('server down'))
        })
      )
      .mockResolvedValue({ insertedCount: 0 })

    exporter.startExporter({ send })

    for (let index = 0; index < 100; index += 1) {
      exporter.enqueueSpan(buildRecord(`early-${index}`))
    }

    const flushed = exporter.flushSpans()

    for (let index = 0; index < 1000; index += 1) {
      exporter.enqueueSpan(buildRecord(`late-${index}`))
    }

    rejectTheFirstBatch()

    await flushed
    await exporter.flushSpans()

    const retried = send.mock.calls
      .slice(1)
      .flatMap((call) => call[0] as { name: string }[])

    // A batch handed back to a buffer that filled up behind it puts the buffer
    // over capacity, so it is trimmed again -- and because the batch goes back
    // to the head first, the spans that go are the oldest of the whole 1100
    // rather than the hundred just returned.
    expect({
      first: retried[0]?.name,
      last: retried[retried.length - 1]?.name,
      retriedCount: retried.length
    }).toEqual({ first: 'late-0', last: 'late-999', retriedCount: 1000 })
  })

  it('reports an outage once, and again after the next one', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('server down'))
      .mockRejectedValueOnce(new Error('still down'))
      .mockResolvedValueOnce({ insertedCount: 1 })
      .mockRejectedValueOnce(new Error('down again'))

    exporter.startExporter({ send })
    exporter.enqueueSpan(buildRecord('kept'))

    await exporter.flushSpans()
    await exporter.flushSpans()
    await exporter.flushSpans()

    exporter.enqueueSpan(buildRecord('later'))

    await exporter.flushSpans()

    // Once per outage rather than once every two seconds for as long as the
    // server is down, and a successful send ends the outage.
    expect(warn.mock.calls.map((call) => call[1])).toEqual([
      new Error('server down'),
      new Error('down again')
    ])
  })

  it('does not start a second flush while one is in flight', async () => {
    let releaseTheFirstSend: () => void = () => undefined

    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseTheFirstSend = () => resolve({ insertedCount: 100 })
          })
      )
      .mockResolvedValue({ insertedCount: 100 })

    exporter.startExporter({ send })

    for (let index = 0; index < 200; index += 1) {
      exporter.enqueueSpan(buildRecord(`span-${index}`))
    }

    const theFirstFlush = exporter.flushSpans()

    // The interval keeps firing while a slow server holds the POST open, so a
    // server taking ten seconds would collect five concurrent requests from a
    // renderer that is meant to be sending one batch at a time -- and each of
    // them would hand a failed batch back to the head of the same buffer, in
    // whatever order they happened to fail.
    await exporter.flushSpans()

    const whileTheFirstIsInFlight = send.mock.calls.length

    releaseTheFirstSend()

    await theFirstFlush

    expect({
      onceTheFirstResolved: send.mock.calls.length,
      whileTheFirstIsInFlight
    }).toEqual({
      onceTheFirstResolved: 2,
      whileTheFirstIsInFlight: 1
    })
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
