import { useCallback, useState } from 'react'

import {
  maximumResizedColumnWidth,
  minimumResizedColumnWidth
} from '../components/query-result-columns'
import {
  type ColumnWidths,
  readColumnWidths,
  writeColumnWidths
} from '../components/result-column-widths-storage'
import { clamp } from './panel-size-storage'

export type ResultColumnWidths = [
  widths: ColumnWidths,
  setWidth: (columnKey: string, width: number) => void
]

interface WidthsState {
  queryId: string
  widths: ColumnWidths
}

/**
 * The widths the user has resized a result's columns to, keyed by column key.
 * A column that was never resized is absent, so the caller falls back to the
 * measured width. Each change is saved under the query's id, which is what
 * makes the widths belong to that result rather than to the worksheet.
 */
export function useResultColumnWidths(queryId: string): ResultColumnWidths {
  const [state, setState] = useState<WidthsState>(() => ({
    queryId,
    widths: readColumnWidths(queryId)
  }))

  // The table stays mounted when a new result replaces the old one, so the
  // widths are swapped during render rather than carried over to it.
  let current = state

  if (state.queryId !== queryId) {
    current = { queryId, widths: readColumnWidths(queryId) }
    setState(current)
  }

  const setWidth = useCallback((columnKey: string, width: number) => {
    if (!Number.isFinite(width)) {
      return
    }

    const clamped = clamp(
      Math.round(width),
      minimumResizedColumnWidth,
      maximumResizedColumnWidth
    )

    // An updater rather than the widths from this render: `ResizeHandle`
    // keeps the `onResize` it was given at mousedown for the whole drag.
    // The write is idempotent, so Strict Mode calling this twice is
    // harmless.
    setState((previous) => {
      const widths = { ...previous.widths, [columnKey]: clamped }

      writeColumnWidths(previous.queryId, widths)

      return { queryId: previous.queryId, widths }
    })
  }, [])

  return [current.widths, setWidth]
}
