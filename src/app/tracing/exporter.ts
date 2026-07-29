import { SpanRecord } from '@/glue/tracing/spans'

const flushBatchSize = 100
const flushIntervalMs = 2000
const maxBufferedSpans = 1000

type SendSpans = (spans: SpanRecord[]) => Promise<unknown>

let buffer: SpanRecord[] = []
let failureStreak = 0
let flushInFlight = false
let flushTimer: ReturnType<typeof setInterval> | undefined
let sendSpans: SendSpans | undefined

export function enqueueSpan(record: SpanRecord): void {
  buffer.push(record)

  // A dead server must not grow renderer memory without bound.
  if (buffer.length > maxBufferedSpans) {
    buffer.splice(0, buffer.length - maxBufferedSpans)
  }
}

export async function flushSpans(): Promise<void> {
  if (!sendSpans || flushInFlight) {
    return
  }

  flushInFlight = true

  try {
    while (buffer.length > 0) {
      const batch = buffer.slice(0, flushBatchSize)

      try {
        await sendSpans(batch)
      } catch (error) {
        failureStreak += 1

        // Log once per outage instead of every two seconds.
        if (failureStreak === 1) {
          console.warn('Could not export trace spans; will retry.', error)
        }

        return
      }

      failureStreak = 0
      buffer = buffer.slice(batch.length)
    }
  } finally {
    flushInFlight = false
  }
}

// The send function is injected so this module stays free of an api-client
// import cycle (api-client creates spans, spans land here).
export function startExporter(options: { send: SendSpans }): void {
  sendSpans = options.send

  if (flushTimer) {
    return
  }

  flushTimer = setInterval(() => {
    void flushSpans()
  }, flushIntervalMs)

  window.addEventListener('beforeunload', () => {
    void flushSpans()
  })
}

export function stopExporter(): void {
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = undefined
  }

  sendSpans = undefined
}
