// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

import { Schema } from 'effect'

import { isValidSpanId, isValidTraceId } from './traceparent'

export const maxAttributeValueLength = 2000
export const maxStacktraceLength = 8000

const SpanIdField = Schema.String.pipe(
  Schema.filter(isValidSpanId, {
    message: () => 'Expected a 16-character hexadecimal span id.'
  })
)

const TraceIdField = Schema.String.pipe(
  Schema.filter(isValidTraceId, {
    message: () => 'Expected a 32-character hexadecimal trace id.'
  })
)

const SpanAttributesField = Schema.mutable(
  Schema.Record({
    key: Schema.String,
    value: Schema.Union(Schema.Boolean, Schema.Number, Schema.String)
  })
)

const SpanEventField = Schema.Struct({
  attributes: Schema.optional(SpanAttributesField),
  name: Schema.String,
  time: Schema.Number
})

// A finished span, and the only declaration of that shape. The renderer builds
// one, ships it, and the server validates the bytes it receives against this
// same schema before writing the row — so the producer's type and the
// consumer's validation cannot drift apart into an ingest that rejects every
// batch the exporter sends.
export const SpanRecord = Schema.Struct({
  attributes: SpanAttributesField,
  durationMs: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0)),
  events: Schema.mutable(Schema.Array(SpanEventField)),
  id: SpanIdField,
  kind: Schema.Literal('client', 'internal', 'server'),
  name: Schema.String.pipe(Schema.minLength(1)),
  parentSpanId: Schema.NullOr(SpanIdField),
  serviceName: Schema.Literal('main', 'renderer'),
  startedAt: Schema.Number,
  status: Schema.Literal('error', 'ok', 'unset'),
  statusMessage: Schema.NullOr(Schema.String),
  traceId: TraceIdField
})
export type SpanRecord = Schema.Schema.Type<typeof SpanRecord>

// Read back off the record rather than written out again, so widening a field
// here is one edit rather than two that can disagree.
export type SpanAttributes = SpanRecord['attributes']

export type SpanAttributeValue = SpanAttributes[string]

export type SpanEvent = SpanRecord['events'][number]

export type SpanKind = SpanRecord['kind']

export type SpanStatus = SpanRecord['status']

export type TraceServiceName = SpanRecord['serviceName']

// Not part of the record: a span carries its parent's id, while this is how a
// live span identifies itself to whatever it starts next.
export interface SpanContext {
  spanId: string
  traceId: string
}

export function truncateValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
