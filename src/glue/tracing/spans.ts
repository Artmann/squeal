// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

export const maxAttributeValueLength = 2000
export const maxStacktraceLength = 8000

export type SpanAttributeValue = boolean | number | string

export type SpanAttributes = Record<string, SpanAttributeValue>

export interface SpanContext {
  spanId: string
  traceId: string
}

export interface SpanEvent {
  attributes?: SpanAttributes
  name: string
  time: number
}

export type SpanKind = 'client' | 'internal' | 'server'

export type SpanStatus = 'error' | 'ok' | 'unset'

export type TraceServiceName = 'main' | 'renderer'

export interface SpanRecord {
  attributes: SpanAttributes
  durationMs: number
  events: SpanEvent[]
  id: string
  kind: SpanKind
  name: string
  parentSpanId: string | null
  serviceName: TraceServiceName
  startedAt: number
  status: SpanStatus
  statusMessage: string | null
  traceId: string
}

export function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
