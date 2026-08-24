import { RefObject, useEffect } from 'react'

interface ScrollToMatchOptions {
  // Index into the result's rows, or -1 for nothing to reveal.
  activeRowIndex: number
  // The same match in the virtualizer's coordinate space, or -1.
  activeVisibleIndex: number
  // Whether the row is in the window the virtualizer is currently painting.
  isActiveRowRendered: boolean
  scrollRef: RefObject<HTMLElement | null>
  scrollToIndex: (index: number, options: { align: 'auto' }) => void
}

/**
 * Brings the match being jumped to into view, vertically and then across.
 *
 * Two effects rather than one, on purpose. `scrollToIndex` sets `scrollTop`
 * synchronously, but the virtualizer re-windows on the scroll event that
 * follows, so the target cell is not in the DOM during that same pass -- the
 * horizontal step has to wait until the row it lives in is actually painted.
 */
export function useScrollToMatch({
  activeRowIndex,
  activeVisibleIndex,
  isActiveRowRendered,
  scrollRef,
  scrollToIndex
}: ScrollToMatchOptions): void {
  useEffect(() => {
    if (activeVisibleIndex < 0) {
      return
    }

    // `auto` leaves the offset alone when the row is already comfortably in
    // view, so stepping between two matches on screen does not jerk the grid.
    scrollToIndex(activeVisibleIndex, { align: 'auto' })
  }, [activeVisibleIndex, scrollToIndex])

  useEffect(() => {
    if (activeRowIndex < 0 || !isActiveRowRendered) {
      return
    }

    // Columns are not virtualized and the table is auto-layout, so the rendered
    // width of a column is not the width that was pinned for it. Asking the
    // browser to reveal the cell is the only reading of the layout that is
    // actually true.
    scrollRef.current
      ?.querySelector('[data-find-active]')
      // Optional call: jsdom does not implement scrollIntoView.
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeRowIndex, isActiveRowRendered, scrollRef])
}
