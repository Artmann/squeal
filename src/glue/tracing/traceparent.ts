// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

import { SpanContext } from './spans'

const spanIdPattern = /^[0-9a-f]{16}$/
const traceIdPattern = /^[0-9a-f]{32}$/
const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

export function formatTraceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-01`
}

// The single source of truth for what counts as a usable id. Ids can arrive
// from anywhere — a traceparent, a b3 header, or the renderer's span ingest —
// and an id that fails this check cannot be looked up again, so it must never
// be stored.
export function isValidSpanId(value: string): boolean {
  return spanIdPattern.test(value) && !isAllZeros(value)
}

export function isValidTraceId(value: string): boolean {
  return traceIdPattern.test(value) && !isAllZeros(value)
}

export function parseTraceparent(
  header: string | undefined
): SpanContext | undefined {
  if (!header) {
    return undefined
  }

  const match = traceparentPattern.exec(header)
  const traceId = match?.[1]
  const spanId = match?.[2]

  if (!traceId || !spanId) {
    return undefined
  }

  if (!isValidTraceId(traceId) || !isValidSpanId(spanId)) {
    return undefined
  }

  return { spanId, traceId }
}

function isAllZeros(value: string): boolean {
  return /^0+$/.test(value)
}
