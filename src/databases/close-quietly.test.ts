import { log } from 'tiny-typescript-logger'
import { describe, expect, it, vi } from 'vitest'

import { closeQuietly } from './close-quietly'

vi.mock('tiny-typescript-logger', () => ({
  log: { warn: vi.fn() }
}))

describe('closeQuietly', () => {
  it('awaits a close that succeeds', async () => {
    const close = vi.fn(() => Promise.resolve())

    await closeQuietly(close, 'query')

    expect(close).toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('swallows a rejecting close and logs the message', async () => {
    vi.mocked(log.warn).mockClear()

    await closeQuietly(
      () => Promise.reject(new Error('socket hang up')),
      'query'
    )

    expect(log.warn).toHaveBeenCalledWith(
      'Could not close the query connection: socket hang up'
    )
  })

  it('swallows a close that throws synchronously', async () => {
    await closeQuietly(() => {
      throw new Error('already destroyed')
    }, 'schema')

    expect(log.warn).toHaveBeenCalledWith(
      'Could not close the schema connection: already destroyed'
    )
  })

  it('describes a non-Error rejection without crashing', async () => {
    vi.mocked(log.warn).mockClear()

    await closeQuietly(() => Promise.reject('nope'), 'probe')

    expect(log.warn).toHaveBeenCalledWith(
      'Could not close the probe connection: nope'
    )
  })
})
