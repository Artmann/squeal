import { useCallback, useEffect, useRef, useState } from 'react'

import { clamp, readStorageItem, writeStorageItem } from './panel-size-storage'

export interface PersistedSizesOptions {
  defaultSize: number
  maximum: number
  // How many per-key sizes the record may hold. The least recently resized key
  // is dropped past this, which is what keeps the record from growing by one
  // entry for every key ever resized.
  maximumKeys: number
  minimum: number
  storageKey: string
}

export interface PersistedSizes {
  setSize: (key: string | undefined, size: number) => void
  sizeFor: (key: string | undefined) => number
}

// The fallback and the per-key overrides are one value because they move
// together: setting a size both remembers it for that key and becomes the size
// a key nobody has resized yet starts at.
interface Sizes {
  default: number
  sizes: Record<string, number>
}

// A stored size only survives when it is a finite number that lands inside the
// current bounds. Hand-edited storage, or bounds that moved between releases,
// fall back to the default rather than laying out a broken panel.
//
// Rounding happens before the bounds test so the number that is checked is the
// number that gets used.
function validSize(
  value: unknown,
  options: PersistedSizesOptions
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }

  const rounded = Math.round(value)

  if (rounded < options.minimum || rounded > options.maximum) {
    return undefined
  }

  return rounded
}

// Insertion order is the recency order — `setSize` re-inserts the key it
// touches — so the oldest entries are simply the first ones.
function capSizes(
  sizes: Record<string, number>,
  maximumKeys: number
): Record<string, number> {
  const keys = Object.keys(sizes)

  if (keys.length <= maximumKeys) {
    return sizes
  }

  return Object.fromEntries(
    keys.slice(keys.length - maximumKeys).map((key) => [key, sizes[key]])
  )
}

function readStoredSizes(options: PersistedSizesOptions): Sizes {
  const empty: Sizes = { default: options.defaultSize, sizes: {} }

  const stored = readStorageItem(options.storageKey)

  if (stored === null) {
    return empty
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(stored)
  } catch {
    return empty
  }

  // A bare number is what this key held while the size was shared by every
  // panel. Reading it as the fallback carries the size the user had chosen
  // into their first per-key session instead of resetting them to the default.
  if (typeof parsed === 'number') {
    return {
      default: validSize(parsed, options) ?? options.defaultSize,
      sizes: {}
    }
  }

  if (parsed === null || typeof parsed !== 'object') {
    return empty
  }

  return readStoredRecord(
    parsed as { default?: unknown; sizes?: unknown },
    options
  )
}

// The record shape, once `readStoredSizes` has established that it is one. Split
// out because the two halves fail differently: everything above rejects the
// stored value whole, everything here keeps what survives and drops the rest.
function readStoredRecord(
  record: { default?: unknown; sizes?: unknown },
  options: PersistedSizesOptions
): Sizes {
  const sizes: Record<string, number> = {}

  // An array survives `typeof === 'object'` and would hand back entries named
  // after its indices, which are keys no worksheet will ever have.
  if (
    record.sizes !== null &&
    typeof record.sizes === 'object' &&
    !Array.isArray(record.sizes)
  ) {
    for (const [key, value] of Object.entries(
      record.sizes as Record<string, unknown>
    )) {
      // V8 puts array-index keys ahead of insertion order, so one in the
      // record would always be evicted first and re-inserting it would never
      // refresh it — the recency this cap evicts by would quietly stop being
      // recency. No worksheet id is one, so anything that looks like an index
      // was hand-edited in.
      if (String(Number(key)) === key) {
        continue
      }

      const size = validSize(value, options)

      if (size !== undefined) {
        sizes[key] = size
      }
    }
  }

  return {
    default: validSize(record.default, options) ?? options.defaultSize,
    sizes: capSizes(sizes, options.maximumKeys)
  }
}

/**
 * Panel sizes in pixels, one per key, clamped to the given bounds and persisted
 * together under `storageKey`.
 *
 * A key with no size of its own takes the last size set anywhere, so opening a
 * key nobody has resized does not snap the panel back to the app default —
 * which is the behaviour a single shared size used to give for free.
 *
 * The record holds at most `maximumKeys` sizes and drops the least recently
 * resized one past that. A cap rather than a sweep of the keys that are still
 * open, because closing a worksheet and opening it again is ordinary, and
 * forgetting its size there would make the feature hold only for as long as the
 * tab does.
 */
export function usePersistedSizes(
  options: PersistedSizesOptions
): PersistedSizes {
  const { maximum, maximumKeys, minimum, storageKey } = options

  const [sizes, setSizes] = useState<Sizes>(() => readStoredSizes(options))

  // Seeded on the first effect run rather than from the read, so a mount that
  // changes nothing writes nothing — otherwise the first thing a new release
  // does is replace the stored value with its own serialization of the same
  // sizes.
  const persistedRef = useRef<string | null>(null)

  useEffect(() => {
    const serialized = JSON.stringify(sizes)

    if (persistedRef.current === null) {
      persistedRef.current = serialized

      return
    }

    if (persistedRef.current === serialized) {
      return
    }

    persistedRef.current = serialized

    writeStorageItem(storageKey, serialized)
  }, [sizes, storageKey])

  const setSize = useCallback(
    (key: string | undefined, nextSize: number) => {
      if (!Number.isFinite(nextSize)) {
        return
      }

      const clamped = clamp(Math.round(nextSize), minimum, maximum)

      setSizes((current) => {
        if (key === undefined) {
          return current.default === clamped
            ? current
            : { default: clamped, sizes: current.sizes }
        }

        const keys = Object.keys(current.sizes)

        // Returning the same object is what stops a drag held past the bounds
        // from re-rendering on every pointer move — it emits the same clamped
        // size over and over, and a record rebuilt each time is a new object
        // even when nothing about it changed. The last term keeps the recency
        // refresh below honest: a key that is not already the most recent one
        // still has to move, whatever its size.
        if (
          current.default === clamped &&
          current.sizes[key] === clamped &&
          keys[keys.length - 1] === key
        ) {
          return current
        }

        // Deleting before inserting is what moves the key to the end of the
        // record: assigning over a key it already holds keeps that key's
        // original position, and position is the recency this cap evicts by.
        const rest = { ...current.sizes }

        delete rest[key]

        return {
          default: clamped,
          sizes: capSizes({ ...rest, [key]: clamped }, maximumKeys)
        }
      })
    },
    [maximum, maximumKeys, minimum]
  )

  const sizeFor = useCallback(
    (key: string | undefined): number => {
      if (key === undefined) {
        return sizes.default
      }

      return sizes.sizes[key] ?? sizes.default
    },
    [sizes]
  )

  return { setSize, sizeFor }
}
