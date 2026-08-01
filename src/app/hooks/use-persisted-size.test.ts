import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePersistedSize } from './use-persisted-size'

const storageKey = 'ui:testSize'

const options = {
  defaultSize: 264,
  maximum: 380,
  minimum: 200,
  storageKey
}

describe('usePersistedSize', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts at the default size when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('starts at the stored size when it is inside the bounds', () => {
    window.localStorage.setItem(storageKey, '312')

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(312)
  })

  it('falls back to the default when the stored size is malformed', () => {
    window.localStorage.setItem(storageKey, 'three hundred')

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('falls back to the default when the stored size is empty', () => {
    window.localStorage.setItem(storageKey, '')

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('falls back to the default when the stored size is below the minimum', () => {
    window.localStorage.setItem(storageKey, '40')

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('falls back to the default when the stored size is above the maximum', () => {
    window.localStorage.setItem(storageKey, '4000')

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('falls back to the default when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Access denied')
    })

    const { result } = renderHook(() => usePersistedSize(options))

    expect(result.current[0]).toEqual(264)
  })

  it('persists a new size', () => {
    const { result } = renderHook(() => usePersistedSize(options))

    act(() => {
      result.current[1](300)
    })

    expect(result.current[0]).toEqual(300)
    expect(window.localStorage.getItem(storageKey)).toEqual('300')
  })

  it('clamps a new size to the bounds', () => {
    const { result } = renderHook(() => usePersistedSize(options))

    act(() => {
      result.current[1](1000)
    })

    expect(result.current[0]).toEqual(380)

    act(() => {
      result.current[1](-50)
    })

    expect(result.current[0]).toEqual(200)
    expect(window.localStorage.getItem(storageKey)).toEqual('200')
  })

  it('rounds fractional sizes', () => {
    const { result } = renderHook(() => usePersistedSize(options))

    act(() => {
      result.current[1](264.6)
    })

    expect(result.current[0]).toEqual(265)
    expect(window.localStorage.getItem(storageKey)).toEqual('265')
  })

  it('ignores sizes that are not finite numbers', () => {
    const { result } = renderHook(() => usePersistedSize(options))

    act(() => {
      result.current[1](Number.NaN)
    })

    expect(result.current[0]).toEqual(264)
    expect(window.localStorage.getItem(storageKey)).toEqual(null)
  })

  it('keeps working when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded')
    })

    const { result } = renderHook(() => usePersistedSize(options))

    act(() => {
      result.current[1](300)
    })

    expect(result.current[0]).toEqual(300)
  })
})
