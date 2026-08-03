import { DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { type SortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useState } from 'react'

// Named along the list rather than along a screen axis, so the same values
// describe a sidebar row and a tab.
export type DropIndicator = 'after' | 'before' | null

// Rows stay put while dragging — the drop indicator line marks the landing
// spot instead of live-shuffling the list.
export const staticListStrategy: SortingStrategy = () => null

// Tracks the dragged and hovered rows so a sortable list can render an
// insertion line. Dropping on the row the drag started from is a no-op, so no
// line is shown for it. Dragging forwards lands after the hovered row,
// backwards before it, matching how arrayMove resolves the drop.
export function useDropIndicator(ids: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null)
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const resetDropIndicator = useCallback(() => {
    setActiveId(null)
    setOverId(null)
  }, [])

  const activeIndex = activeId ? ids.indexOf(activeId) : -1
  const overIndex = overId ? ids.indexOf(overId) : -1
  const hasDropTarget =
    activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex

  const dropIndicatorFor = (index: number): DropIndicator => {
    if (!hasDropTarget || index !== overIndex) {
      return null
    }

    return activeIndex < overIndex ? 'after' : 'before'
  }

  return {
    dropIndicatorFor,
    handleDragOver,
    handleDragStart,
    resetDropIndicator
  }
}
