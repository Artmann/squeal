import { ReactElement, ReactNode, useCallback, useEffect, useRef } from 'react'

import { cn } from '../lib/utils'

const resizeStep = 10
const largeResizeStep = 40

type ResizeGrowth = 'end' | 'start'
type ResizeOrientation = 'col' | 'row'

interface ResizeHandleProps {
  ariaLabel: string
  children?: ReactNode
  className?: string
  // Which way the pointer moves to make the panel bigger. A handle on the
  // panel's trailing edge grows toward 'end' (right or down); one on its
  // leading edge, like the results splitter, grows toward 'start'.
  growsToward?: ResizeGrowth
  onResize: (size: number) => void
  orientation: ResizeOrientation
  size: number
}

// A draggable separator that reports the panel's new size in pixels. Clamping
// and persistence belong to the caller (see `usePersistedSize`), so the same
// handle serves the sidebar (`col`) and the results splitter (`row`).
export function ResizeHandle({
  ariaLabel,
  children,
  className,
  growsToward = 'end',
  onResize,
  orientation,
  size
}: ResizeHandleProps): ReactElement {
  // Dragging outlives a single event handler, so the teardown is kept around
  // to run on unmount too — a dropped listener would keep resizing a panel
  // that no longer exists.
  const detachRef = useRef<(() => void) | null>(null)

  // The only place a drag is released. A mouseup, a second mousedown that
  // never got one, and unmount all end a drag the same way, so they all come
  // through here instead of each undoing its own subset.
  const endDrag = useCallback(() => {
    detachRef.current?.()
    detachRef.current = null
  }, [])

  // `endDrag` has to keep its empty dependency list. This effect re-runs its
  // cleanup whenever `endDrag` changes, and that cleanup aborts a live drag —
  // so giving `endDrag` a render-state dependency would kill every drag on its
  // first pixel, since `size` changes on every mousemove.
  useEffect(() => {
    return endDrag
  }, [endDrag])

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      // Only the primary button drags. A right-click opening the context menu
      // is one of the ways a mouseup goes missing, so refusing it removes a
      // cause instead of only recovering from one.
      if (event.button !== 0) {
        return
      }

      // A second mousedown without a mouseup should never stack listeners.
      endDrag()

      const direction = growsToward === 'start' ? -1 : 1
      const startPosition =
        orientation === 'col' ? event.clientX : event.clientY
      const startSize = size

      function handleMouseMove(moveEvent: MouseEvent): void {
        const position =
          orientation === 'col' ? moveEvent.clientX : moveEvent.clientY

        onResize(startSize + direction * (position - startPosition))
      }

      function detach(): void {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', endDrag)

        // Released by removing the property, never by restoring a value read
        // at mousedown. Both of the handles the app mounts write to this one
        // global style, so a handle that sampled it while the other sat
        // mid-drag would capture 'none' and restore 'none' on every drag
        // afterwards — text selection dead app-wide with no drag in sight.
        // With nothing sampled there is nothing to poison, and releasing
        // twice or out of order is harmless.
        document.body.style.removeProperty('user-select')
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', endDrag)
      document.body.style.userSelect = 'none'
      detachRef.current = detach
    },
    [endDrag, growsToward, onResize, orientation, size]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const direction = growsToward === 'start' ? -1 : 1
      const step = event.shiftKey ? largeResizeStep : resizeStep
      const growKey = orientation === 'col' ? 'ArrowRight' : 'ArrowDown'
      const shrinkKey = orientation === 'col' ? 'ArrowLeft' : 'ArrowUp'

      if (event.key === growKey) {
        event.preventDefault()
        onResize(size + direction * step)
      }

      if (event.key === shrinkKey) {
        event.preventDefault()
        onResize(size - direction * step)
      }
    },
    [growsToward, onResize, orientation, size]
  )

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation={orientation === 'col' ? 'vertical' : 'horizontal'}
      className={cn(
        'group z-10 flex flex-none items-center justify-center',
        orientation === 'col' ? 'cursor-col-resize' : 'cursor-row-resize',
        className
      )}
      role="separator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  )
}
