import { describe, expect, it } from 'vitest'

import { formatTraceparent, isValidSpanId, isValidTraceId } from './traceparent'

const spanId = '00f067aa0ba902b7'
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

describe('formatTraceparent', () => {
  it('formats a span context as a sampled version 00 header', () => {
    expect(formatTraceparent({ spanId, traceId })).toEqual(
      `00-${traceId}-${spanId}-01`
    )
  })
})

// These two decide whether an id is usable, and every id reaching the app from
// outside goes through them: a `traceparent`, a `b3` header, the renderer's
// span ingest, and the `/traces` route parameters — the last three through
// `Schema.filter` in `src/glue/api/schemas.ts`. An id that fails here cannot be
// looked up again, so storing one produces a trace the dashboard lists and
// `GET /traces/:id` then refuses to open.
//
// The cases below are the ones no caller covers. `@effect/platform` matches the
// same hex shape case-insensitively, so an uppercase id reaches these and
// nothing else rejects it; `b3` does not validate at all, so everything reaches
// these. Both spellings of a wrong-but-plausible pattern — an `i` flag, or
// `a-z` in the character class — otherwise survive the entire suite.
describe('isValidTraceId', () => {
  it.each([
    {
      accepted: true,
      description: 'a lowercase 32-character id',
      value: traceId
    },
    {
      accepted: false,
      description: 'the same id in uppercase',
      value: traceId.toUpperCase()
    },
    { accepted: false, description: 'all zeros', value: '0'.repeat(32) },
    {
      accepted: true,
      description: 'leading zeros that are not all of them',
      value: `${'0'.repeat(31)}1`
    },
    {
      accepted: false,
      description: 'non-hex characters',
      value: 'z'.repeat(32)
    },
    { accepted: false, description: 'too few characters', value: '0123456789' },
    { accepted: false, description: 'a span id', value: spanId },
    { accepted: false, description: 'nothing at all', value: '' }
  ])('is $accepted for $description', ({ accepted, value }) => {
    expect(isValidTraceId(value)).toEqual(accepted)
  })
})

describe('isValidSpanId', () => {
  it.each([
    {
      accepted: true,
      description: 'a lowercase 16-character id',
      value: spanId
    },
    {
      accepted: false,
      description: 'the same id in uppercase',
      value: spanId.toUpperCase()
    },
    { accepted: false, description: 'all zeros', value: '0'.repeat(16) },
    {
      accepted: true,
      description: 'leading zeros that are not all of them',
      value: `${'0'.repeat(15)}1`
    },
    {
      accepted: false,
      description: 'non-hex characters',
      value: 'z'.repeat(16)
    },
    { accepted: false, description: 'too few characters', value: '0123' },
    { accepted: false, description: 'a trace id', value: traceId },
    { accepted: false, description: 'nothing at all', value: '' }
  ])('is $accepted for $description', ({ accepted, value }) => {
    expect(isValidSpanId(value)).toEqual(accepted)
  })
})
