import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePersistedSizes } from './use-persisted-sizes'

const storageKey = 'ui:resultsHeight'

// Small on purpose: eviction is the interesting behaviour, and three keys make
// it visible without a wall of setup.
function renderSizes(maximumKeys = 3) {
  return renderHook(() =>
    usePersistedSizes({
      defaultSize: 320,
      maximum: 620,
      maximumKeys,
      minimum: 120,
      storageKey
    })
  )
}

// Reads the whole picture rather than the one key a test expects to have
// moved, so a change that leaks into the others cannot pass.
function sizes(
  sizeFor: (key: string | undefined) => number
): Record<string, number> {
  return {
    none: sizeFor(undefined),
    'ws-1': sizeFor('ws-1'),
    'ws-2': sizeFor('ws-2')
  }
}

// Counts renders as well as returning the hook, which is the only way to see
// a resize that changes nothing still costing one.
function renderCountedSizes(maximumKeys = 3) {
  const renders = { count: 0 }

  const { result } = renderHook(() => {
    renders.count += 1

    return usePersistedSizes({
      defaultSize: 320,
      maximum: 620,
      maximumKeys,
      minimum: 120,
      storageKey
    })
  })

  return { renders, result }
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(storageKey) ?? 'null')
}

describe('usePersistedSizes', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('gives every key the default size when nothing is stored', () => {
    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 320,
      'ws-2': 320
    })
  })

  it('keeps a size of its own for each key', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    act(() => {
      result.current.setSize('ws-2', 200)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 200,
      'ws-1': 500,
      'ws-2': 200
    })
  })

  // Snapping an unresized key back to the app default would read as the panel
  // jumping every time one is opened, which is the one thing a single shared
  // size got right.
  it('starts a key nobody has resized at the last size set anywhere', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 500,
      'ws-1': 500,
      'ws-2': 500
    })
  })

  it('leaves a key that has been resized where the user put it', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-2', 200)
    })

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 500,
      'ws-1': 500,
      'ws-2': 200
    })
  })

  it('moves only the fallback when a size is set with no key', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    act(() => {
      result.current.setSize(undefined, 250)
    })

    // The stored record is read too: a size set with no key belongs in the
    // fallback and nowhere else. Writing it under the key it did not get gives
    // the record an entry named after the missing argument.
    expect({
      sizes: sizes(result.current.sizeFor),
      stored: stored()
    }).toEqual({
      sizes: { none: 250, 'ws-1': 500, 'ws-2': 250 },
      stored: { default: 250, sizes: { 'ws-1': 500 } }
    })
  })

  it('clamps a size to the bounds', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 9000)
    })

    act(() => {
      result.current.setSize('ws-2', -40)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 120,
      'ws-1': 620,
      'ws-2': 120
    })
  })

  it('ignores a size that is not a finite number', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', Number.NaN)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 320,
      'ws-2': 320
    })
  })

  it('keeps sizes across an unmount', () => {
    const first = renderSizes()

    act(() => {
      first.result.current.setSize('ws-1', 500)
    })

    first.unmount()

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 500,
      'ws-1': 500,
      'ws-2': 500
    })
  })

  // A mount that changes nothing must not write: the first thing this hook
  // does on a fresh install would otherwise be to replace the size a previous
  // release stored with its own serialization of the same number.
  it('writes nothing on a mount that changes nothing', () => {
    localStorage.setItem(storageKey, '480')

    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    renderSizes()

    expect(setItem.mock.calls).toEqual([])
  })

  // Dragging a handle emits a size on every pointer move, and most of them
  // repeat the last one. Serializing is cheap; a storage write per pixel is
  // not.
  it('writes nothing when a size is set to what it already was', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    expect(setItem.mock.calls).toEqual([])
  })

  // A drag emits a size on every pointer move, and a drag held past the bounds
  // emits the same clamped one over and over. The old shared size got this for
  // free — React bails out when a state number is unchanged — and a record that
  // is rebuilt every time does not.
  it('does not re-render when a size is set to what it already was', () => {
    const { renders, result } = renderCountedSizes()

    // The resize, then one repeat: React renders once more before it bails out
    // on a state object that came back unchanged, and only the moves after that
    // are free.
    act(() => {
      result.current.setSize('ws-1', 500)
    })

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    const before = renders.count

    for (let move = 0; move < 10; move += 1) {
      act(() => {
        result.current.setSize('ws-1', 500)
      })
    }

    expect(renders.count).toEqual(before)
  })

  // Nor may it swallow a real change. The fallback moving to a number the key
  // does not hold is not the key changing, so resizing the key to that same
  // number afterwards still has to land on it.
  it('resizes a key to the size the fallback already holds', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    act(() => {
      result.current.setSize(undefined, 300)
    })

    act(() => {
      result.current.setSize('ws-1', 300)
    })

    expect(stored()).toEqual({ default: 300, sizes: { 'ws-1': 300 } })
  })

  // The bail-out above must not swallow the recency refresh: re-setting the
  // size a key already has is still the user using that key, and dropping it
  // for that reason would evict the key they just touched.
  it('counts a repeated size as using the key again', () => {
    const { result } = renderSizes()

    for (const key of ['ws-1', 'ws-2', 'ws-3', 'ws-1']) {
      act(() => {
        result.current.setSize(key, 500)
      })
    }

    act(() => {
      result.current.setSize('ws-4', 400)
    })

    expect(stored()).toEqual({
      default: 400,
      sizes: { 'ws-1': 500, 'ws-3': 500, 'ws-4': 400 }
    })
  })

  // V8 orders array-index keys ahead of insertion order, so one in the record
  // is always evicted first and re-inserting it never refreshes it — the
  // recency this cap evicts by would silently stop being recency. No worksheet
  // id is one (they are UUIDs), so anything that looks like an index was
  // hand-edited in.
  it('takes no size from an array-index key in storage', () => {
    localStorage.setItem(storageKey, '{"sizes":{"2":300,"ws-1":500}}')

    const { result } = renderSizes()

    expect({
      '2': result.current.sizeFor('2'),
      'ws-1': result.current.sizeFor('ws-1')
    }).toEqual({ '2': 320, 'ws-1': 500 })
  })

  // What this key held while the size was shared by every panel. Reading it as
  // the fallback carries the height the user chose into their first per-key
  // session instead of resetting them to the default.
  it('reads a bare number left by an earlier release as the fallback', () => {
    localStorage.setItem(storageKey, '480')

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 480,
      'ws-1': 480,
      'ws-2': 480
    })
  })

  it('falls back to the default when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Access to storage is denied.')
    })

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 320,
      'ws-2': 320
    })
  })

  it('still resizes when storage refuses to be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('The storage quota has been exceeded.')
    })

    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 500,
      'ws-1': 500,
      'ws-2': 500
    })
  })

  // Every one of these is a value a hand-edit or an older release can leave
  // behind, and the read runs inside a `useState` initializer — so anything
  // that throws here takes the whole editor down on boot rather than losing a
  // panel size.
  it.each([
    ['nonsense that is not JSON', 'not json at all'],
    ['a stored null', 'null'],
    ['a stored string', '"480"'],
    ['a record whose sizes are null', '{"sizes":null}'],
    ['a size below the minimum', '{"sizes":{"ws-1":40}}'],
    ['a size above the maximum', '{"sizes":{"ws-1":5000}}'],
    ['a size that parses to infinity', '{"sizes":{"ws-1":1e999}}'],
    ['a size that is not a number', '{"sizes":{"ws-1":"500"}}']
  ])('survives %s in storage', (_description, value) => {
    localStorage.setItem(storageKey, value)

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 320,
      'ws-2': 320
    })
  })

  // An array clears `typeof === 'object'`, and reading one as a record gives
  // entries named after its indices — sizes belonging to keys no worksheet
  // will ever have, held against the cap forever.
  it('takes no sizes from a record whose sizes are an array', () => {
    localStorage.setItem(storageKey, '{"sizes":[500,200]}')

    const { result } = renderSizes()

    expect({
      '0': result.current.sizeFor('0'),
      '1': result.current.sizeFor('1'),
      none: result.current.sizeFor(undefined)
    }).toEqual({ '0': 320, '1': 320, none: 320 })
  })

  it('rounds a fractional stored size', () => {
    localStorage.setItem(storageKey, '{"default":320,"sizes":{"ws-1":500.6}}')

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 501,
      'ws-2': 320
    })
  })

  // The bound. Without it the record grows by one entry for every key ever
  // resized and never gives one back.
  it('drops the least recently sized key once the record is full', () => {
    const { result } = renderSizes()

    for (const [key, size] of [
      ['ws-1', 500],
      ['ws-2', 200],
      ['ws-3', 300],
      ['ws-4', 400]
    ] as const) {
      act(() => {
        result.current.setSize(key, size)
      })
    }

    expect(stored()).toEqual({
      default: 400,
      sizes: { 'ws-2': 200, 'ws-3': 300, 'ws-4': 400 }
    })
  })

  it('counts resizing a key as using it again', () => {
    const { result } = renderSizes()

    for (const [key, size] of [
      ['ws-1', 500],
      ['ws-2', 200],
      ['ws-3', 300],
      ['ws-1', 480],
      ['ws-4', 400]
    ] as const) {
      act(() => {
        result.current.setSize(key, size)
      })
    }

    expect(stored()).toEqual({
      default: 400,
      sizes: { 'ws-1': 480, 'ws-3': 300, 'ws-4': 400 }
    })
  })

  // The reason the bound is a cap rather than a sweep of the keys that are
  // still open: closing a worksheet's tab and opening it again is ordinary,
  // and forgetting its height there would make the feature hold only for as
  // long as the tab does.
  it('keeps the size of a key that is not being used right now', () => {
    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    act(() => {
      result.current.setSize('ws-2', 200)
    })

    expect(result.current.sizeFor('ws-1')).toEqual(500)
  })

  // The read trims what the hook uses, not what is on disk: the oversized
  // record stays in storage until the next resize rewrites it, because a mount
  // that changes nothing deliberately writes nothing. What must not happen is
  // the extra entries counting against the cap for the rest of the session.
  it('forgets the oldest stored sizes when the record arrives over the cap', () => {
    localStorage.setItem(
      storageKey,
      '{"default":320,"sizes":{"ws-1":500,"ws-2":200,"ws-3":300,"ws-4":400}}'
    )

    const { result } = renderSizes()

    expect(sizes(result.current.sizeFor)).toEqual({
      none: 320,
      'ws-1': 320,
      'ws-2': 200
    })
  })

  it('trims a stored record that is over the cap', () => {
    localStorage.setItem(
      storageKey,
      '{"default":320,"sizes":{"ws-1":500,"ws-2":200,"ws-3":300,"ws-4":400}}'
    )

    const { result } = renderSizes()

    act(() => {
      result.current.setSize('ws-5', 360)
    })

    expect(stored()).toEqual({
      default: 360,
      sizes: { 'ws-3': 300, 'ws-4': 400, 'ws-5': 360 }
    })
  })

  // React mounts every component twice in development, so an effect that
  // writes on the second pass would double every write in the real app.
  it('writes once under StrictMode', () => {
    const { result } = renderHook(
      () =>
        usePersistedSizes({
          defaultSize: 320,
          maximum: 620,
          maximumKeys: 3,
          minimum: 120,
          storageKey
        }),
      { wrapper: StrictMode }
    )

    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    act(() => {
      result.current.setSize('ws-1', 500)
    })

    expect(setItem.mock.calls).toEqual([
      [storageKey, '{"default":500,"sizes":{"ws-1":500}}']
    ])
  })
})
