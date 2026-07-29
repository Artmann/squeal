import { describe, expect, it } from 'vitest'

import { generateSpanId, generateTraceId } from './ids'

describe('generateSpanId', () => {
  it('returns 16 lowercase hex characters', () => {
    expect(generateSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns a different id on every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()))

    expect(ids.size).toEqual(100)
  })
})

describe('generateTraceId', () => {
  it('returns 32 lowercase hex characters', () => {
    expect(generateTraceId()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('returns a different id on every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()))

    expect(ids.size).toEqual(100)
  })
})
