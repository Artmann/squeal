// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

import { SpanContext } from './spans'

const spanIdPattern = /^[0-9a-f]{16}$/
const traceIdPattern = /^[0-9a-f]{32}$/

export function formatTraceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-01`
}

// The single source of truth for what counts as a usable id. Ids can arrive
// from anywhere — a traceparent, a b3 header, or the renderer's span ingest —
// and an id that fails this check cannot be looked up again, so it must never
// be stored.
//
// Reading the header is not this module's job. `@effect/platform` does it in
// its own HTTP middleware and hands the result to the request span as its
// parent; these two are what `SquealSpan` then applies to that parent, because
// the platform accepts ids the spec forbids — all-zero ones, and uppercase hex,
// since its patterns carry the `i` flag — and does not check a `b3` header at
// all. See `src/server/http/traceparent-propagation.test.ts` for the path from
// header to parent.
export function isValidSpanId(value: string): boolean {
  return spanIdPattern.test(value) && !isAllZeros(value)
}

export function isValidTraceId(value: string): boolean {
  return traceIdPattern.test(value) && !isAllZeros(value)
}

function isAllZeros(value: string): boolean {
  return /^0+$/.test(value)
}
