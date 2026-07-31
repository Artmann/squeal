import { describe, expect, it, vi } from 'vitest'

import { memoizePromise } from './memoize-promise'

describe('memoizePromise', () => {
  it('creates the value once and reuses it', async () => {
    const create = vi.fn(() => Promise.resolve('token'))
    const get = memoizePromise(create)

    expect([await get(), await get(), await get()]).toEqual([
      'token',
      'token',
      'token'
    ])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('shares one in-flight promise between concurrent callers', async () => {
    const create = vi.fn(() => Promise.resolve('token'))
    const get = memoizePromise(create)

    expect(await Promise.all([get(), get()])).toEqual(['token', 'token'])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('retries after a rejection instead of caching the failure', async () => {
    const create = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('IPC unavailable'))
      .mockResolvedValueOnce('token')
    const get = memoizePromise(create)

    await expect(get()).rejects.toThrow('IPC unavailable')

    expect(await get()).toEqual('token')
    expect(create).toHaveBeenCalledTimes(2)
  })
})
