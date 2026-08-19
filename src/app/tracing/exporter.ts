import { SpanRecord } from '@/glue/tracing/spans'

const flushBatchSize = 100
const flushIntervalMs = 2000
const maxBufferedSpans = 1000

type SendSpans = (spans: SpanRecord[]) => Promise<unknown>

// Never reassigned: the flush below hands its batch back into this same array
// on failure, so a second array would strand whichever one the exporter was
// not holding.
const buffer: SpanRecord[] = []

let flushInFlight = false
let flushTimer: ReturnType<typeof setInterval> | undefined
let hasReportedOutage = false
let sendSpans: SendSpans | undefined

// A dead server must not grow renderer memory without bound. The only place a
// span is ever dropped, so the drop-oldest policy is stated once.
function trimToCapacity(): void {
  if (buffer.length > maxBufferedSpans) {
    buffer.splice(0, buffer.length - maxBufferedSpans)
  }
}

export function enqueueSpan(record: SpanRecord): void {
  buffer.push(record)

  trimToCapacity()
}

export async function flushSpans(): Promise<void> {
  if (!sendSpans || flushInFlight) {
    return
  }

  flushInFlight = true

  try {
    while (buffer.length > 0) {
      // Taken out of the buffer rather than copied from it. enqueueSpan runs
      // while the POST below is awaited -- any user action ends a traced span
      // -- so a batch identified by its position would be a different hundred
      // spans by the time the request resolved, and dropping that many from
      // the head would discard spans that were never sent.
      const batch = buffer.splice(0, flushBatchSize)

      try {
        await sendSpans(batch)
      } catch (error) {
        // Back onto the head before the trim, so drop-oldest still drops the
        // oldest spans overall rather than the ones just handed back.
        buffer.unshift(...batch)

        trimToCapacity()

        // Log once per outage instead of every two seconds.
        if (!hasReportedOutage) {
          hasReportedOutage = true

          console.warn('Could not export trace spans; will retry.', error)
        }

        return
      }

      hasReportedOutage = false
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
