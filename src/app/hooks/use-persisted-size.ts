import { useCallback, useState } from 'react'

import { clamp, readStorageItem, writeStorageItem } from './panel-size-storage'

export interface PersistedSizeOptions {
  defaultSize: number
  maximum: number
  minimum: number
  storageKey: string
}

export type PersistedSize = [size: number, setSize: (size: number) => void]

// A stored size only survives when it is a finite number inside the current
// bounds. Hand-edited storage, or bounds that moved between releases, fall
// back to the default rather than laying out a broken panel.
function readStoredSize(options: PersistedSizeOptions): number {
  const { defaultSize, maximum, minimum, storageKey } = options

  const stored = readStorageItem(storageKey)

  if (stored === null || stored.trim() === '') {
    return defaultSize
  }

  const parsed = Number(stored)

  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return defaultSize
  }

  return Math.round(parsed)
}

// Panel size in pixels, clamped to the given bounds and persisted under
// `storageKey`. Shared by the sidebar and the results splitter, so it stays
// free of any assumption about which axis it measures.
export function usePersistedSize(options: PersistedSizeOptions): PersistedSize {
  const { defaultSize, maximum, minimum, storageKey } = options

  const [size, setStoredSize] = useState(() =>
    readStoredSize({ defaultSize, maximum, minimum, storageKey })
  )

  const setSize = useCallback(
    (nextSize: number) => {
      if (!Number.isFinite(nextSize)) {
        return
      }

      const clamped = clamp(Math.round(nextSize), minimum, maximum)

      setStoredSize(clamped)
      writeStorageItem(storageKey, String(clamped))
    },
    [maximum, minimum, storageKey]
  )

  return [size, setSize]
}
