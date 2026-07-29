import { describe, expect, it } from 'vitest'

import { formatTraceparent, parseTraceparent } from './traceparent'

const spanId = '00f067aa0ba902b7'
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'

describe('formatTraceparent', () => {
  it('formats a span context as a sampled version 00 header', () => {
    expect(formatTraceparent({ spanId, traceId })).toEqual(
      `00-${traceId}-${spanId}-01`
    )
  })
})

describe('parseTraceparent', () => {
  it('parses a valid header', () => {
    expect(parseTraceparent(`00-${traceId}-${spanId}-01`)).toEqual({
      spanId,
      traceId
    })
  })

  it('accepts any flag byte', () => {
    expect(parseTraceparent(`00-${traceId}-${spanId}-00`)).toEqual({
      spanId,
      traceId
    })
  })

  it.each([
    ['undefined', undefined],
    ['an empty string', ''],
    ['a wrong version', `ff-${traceId}-${spanId}-01`],
    ['a short trace id', `00-${traceId.slice(1)}-${spanId}-01`],
    ['a short span id', `00-${traceId}-${spanId.slice(1)}-01`],
    ['uppercase hex', `00-${traceId.toUpperCase()}-${spanId}-01`],
    ['an all-zero trace id', `00-${'0'.repeat(32)}-${spanId}-01`],
    ['an all-zero span id', `00-${traceId}-${'0'.repeat(16)}-01`],
    ['missing flags', `00-${traceId}-${spanId}`],
    ['extra segments', `00-${traceId}-${spanId}-01-99`]
  ])('returns undefined for %s', (_label, header) => {
    expect(parseTraceparent(header)).toEqual(undefined)
  })
})
