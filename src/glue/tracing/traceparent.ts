// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

import { SpanContext } from './spans'

const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/

export function formatTraceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-01`
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

  if (isAllZeros(traceId) || isAllZeros(spanId)) {
    return undefined
  }

  return { spanId, traceId }
}

function isAllZeros(value: string): boolean {
  return /^0+$/.test(value)
}
