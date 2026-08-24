import { useCallback, useEffect, useState } from 'react'

import { useAppSelector } from '../store'
import { selectOpenWorksheetIds } from '../store/tabs-slice'

export interface PerWorksheetState<T> {
  update: (worksheetId: string | undefined, change: (current: T) => T) => void
  valueFor: (worksheetId: string | undefined) => T
}

/**
 * A value held one worksheet at a time, for the worksheets whose tabs are open.
 *
 * Coming back to a tab should find it as it was left, which one shared value
 * cannot do -- switching tabs would snap every worksheet to whatever the last
 * one did. The record is bounded by the open tabs rather than by every
 * worksheet visited this session, so it cannot grow for the life of the
 * process.
 *
 * `fallback` is read on every render, so callers pass a constant rather than a
 * fresh literal: an unstable one would rebuild both callbacks each time.
 */
export function usePerWorksheetState<T>(fallback: T): PerWorksheetState<T> {
  const openWorksheetIds = useAppSelector(selectOpenWorksheetIds)

  const [valueByWorksheet, setValueByWorksheet] = useState<Record<string, T>>(
    {}
  )

  useEffect(() => {
    const open = new Set(openWorksheetIds)

    setValueByWorksheet((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => open.has(id))
      )

      // Same size means nothing was dropped, and returning `current` there is
      // what stops this from re-rendering every consumer on each tab change.
      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next
    })
  }, [openWorksheetIds])

  const valueFor = useCallback(
    (worksheetId: string | undefined): T =>
      (worksheetId ? valueByWorksheet[worksheetId] : undefined) ?? fallback,
    [fallback, valueByWorksheet]
  )

  const update = useCallback(
    (worksheetId: string | undefined, change: (current: T) => T): void => {
      // No worksheet is no key to store under, so there is nothing to remember
      // rather than a shared slot to fall back on.
      if (!worksheetId) {
        return
      }

      setValueByWorksheet((current) => {
        const existing = current[worksheetId] ?? fallback
        const next = change(existing)

        // An unchanged value returns the record itself, which is what lets
        // React bail out rather than re-render every consumer for a move that
        // did nothing -- stepping through an empty match list, say.
        return next === existing ? current : { ...current, [worksheetId]: next }
      })
    },
    [fallback]
  )

  return { update, valueFor }
}
