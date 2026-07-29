import { describe, expect, it } from 'vitest'

import { shouldSkipTracing } from './trace-skip'

describe('shouldSkipTracing', () => {
  it('skips the health check', () => {
    expect(shouldSkipTracing('GET', '/health')).toEqual(true)
  })

  it('skips all trace routes', () => {
    expect(shouldSkipTracing('GET', '/traces')).toEqual(true)
    expect(shouldSkipTracing('GET', '/traces/abc123')).toEqual(true)
    expect(shouldSkipTracing('POST', '/traces/spans')).toEqual(true)
  })

  it('skips the query result poller', () => {
    expect(shouldSkipTracing('GET', '/queries/some-id')).toEqual(true)
  })

  it('traces query creation and listing', () => {
    expect(shouldSkipTracing('POST', '/queries')).toEqual(false)
    expect(shouldSkipTracing('GET', '/queries')).toEqual(false)
    expect(shouldSkipTracing('POST', '/queries/some-id/cancel')).toEqual(false)
  })

  it('traces everything else', () => {
    expect(shouldSkipTracing('GET', '/databases')).toEqual(false)
    expect(shouldSkipTracing('POST', '/worksheets')).toEqual(false)
  })
})
