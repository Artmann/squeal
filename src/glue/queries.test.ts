import { describe, expect, it } from 'vitest'

import { isQueryFinished, isQueryInFlight } from './queries'

describe('isQueryInFlight', () => {
  it('is false without a query', () => {
    expect(isQueryInFlight(undefined)).toEqual(false)
  })

  it('is true while finishedAt is null', () => {
    expect(isQueryInFlight({ finishedAt: null })).toEqual(true)
  })

  it('is false once finishedAt is set', () => {
    expect(isQueryInFlight({ finishedAt: 3373 })).toEqual(false)
  })

  // The callers this replaced tested finishedAt for falsiness, which read a
  // query finished at epoch 0 as still running. No producer emits 0 today.
  it('treats a query finished at 0 as finished', () => {
    expect(isQueryInFlight({ finishedAt: 0 })).toEqual(false)
  })
})

describe('isQueryFinished', () => {
  it('is false without a query', () => {
    expect(isQueryFinished(undefined)).toEqual(false)
  })

  it('is false while finishedAt is null', () => {
    expect(isQueryFinished({ finishedAt: null })).toEqual(false)
  })

  it('is true once finishedAt is set', () => {
    expect(isQueryFinished({ finishedAt: 3373 })).toEqual(true)
  })

  it('is true for a query finished at 0', () => {
    expect(isQueryFinished({ finishedAt: 0 })).toEqual(true)
  })
})
