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
  onResizeEnd?: () => void
  onResizeStart?: () => void
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
  onResizeEnd,
  onResizeStart,
  orientation,
  size
}: ResizeHandleProps): ReactElement {
  // Dragging outlives a single event handler, so the teardown is kept around
  // to run on unmount too — a dropped listener would keep resizing a panel
  // that no longer exists.
  const detachRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      detachRef.current?.()
      detachRef.current = null
    }
  }, [])

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      const direction = growsToward === 'start' ? -1 : 1
      const startPosition =
        orientation === 'col' ? event.clientX : event.clientY
      const startSize = size
      const previousUserSelect = document.body.style.userSelect

      function handleMouseMove(moveEvent: MouseEvent): void {
        const position =
          orientation === 'col' ? moveEvent.clientX : moveEvent.clientY

        onResize(startSize + direction * (position - startPosition))
      }

      function detach(): void {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.userSelect = previousUserSelect
      }

      function handleMouseUp(): void {
        detach()
        detachRef.current = null
        onResizeEnd?.()
      }

      // A second mousedown without a mouseup should never stack listeners.
      detachRef.current?.()

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = 'none'
      detachRef.current = detach

      onResizeStart?.()
    },
    [growsToward, onResize, onResizeEnd, onResizeStart, orientation, size]
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
