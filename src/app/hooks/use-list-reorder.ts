import {
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import {
  restrictToHorizontalAxis,
  restrictToVerticalAxis
} from '@dnd-kit/modifiers'
import { arrayMove, type SortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useState } from 'react'

// Named along the list rather than along a screen axis, so the same values
// describe a sidebar row and a tab.
export type DropIndicator = 'after' | 'before' | null

// Rows stay put while dragging — the drop indicator line marks the landing
// spot instead of live-shuffling the list.
export const staticListStrategy: SortingStrategy = () => null

// Module scope because there are exactly two of them and neither depends on
// anything — not for identity, which `DndContext` does not read: it applies
// its modifiers on every render regardless.
const axisModifiers = {
  horizontal: [restrictToHorizontalAxis],
  vertical: [restrictToVerticalAxis]
}

// One value for the whole drag. `null` is "no drag", and anything else names
// the row being dragged — which is what makes "hovering a row while dragging
// nothing" unrepresentable rather than something the reader has to rule out.
interface Drag {
  activeId: string
  overId: string | null
}

interface ListReorderDndContextProps {
  collisionDetection: DndContextProps['collisionDetection']
  modifiers: DndContextProps['modifiers']
  onDragCancel: (event: DragCancelEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragOver: (event: DragOverEvent) => void
  onDragStart: (event: DragStartEvent) => void
  sensors: DndContextProps['sensors']
}

interface ListReorder {
  dndContextProps: ListReorderDndContextProps
  dropIndicatorFor: (id: string) => DropIndicator
}

interface UseListReorderOptions {
  axis: 'horizontal' | 'vertical'
  ids: string[]
  onReorder: (orderedIds: string[]) => void
}

/**
 * Owns a sortable list's whole drag: the dnd-kit wiring, the insertion line,
 * and the reorder the drop produces.
 *
 * Every handler travels in `dndContextProps`, so a call site spreads them onto
 * `DndContext` in one go and cannot wire the start of a drag without its end —
 * a forgotten `onDragCancel` used to leave the line on screen for good.
 *
 * `ids` is the list the reorder runs over, which is not always the list on
 * screen: a filtered sidebar reorders the whole thing, and the tab strip
 * reorders every open tab including one whose worksheet has just gone. The
 * indicator is asked for by id rather than by position, so the rendered rows
 * only have to be some subsequence of `ids` — nothing has to line up by index.
 */
export function useListReorder(options: UseListReorderOptions): ListReorder {
  const { axis, ids, onReorder } = options

  const [drag, setDrag] = useState<Drag | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragCancel = useCallback(() => {
    setDrag(null)
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      setDrag(null)

      if (!over || active.id === over.id) {
        return
      }

      const activeIndex = ids.indexOf(String(active.id))
      const overIndex = ids.indexOf(String(over.id))

      // Same reason as the indicator below: `arrayMove` reads -1 as a position
      // and scrambles the order rather than refusing, so a row that has left
      // the list mid-drag has to be caught here.
      if (activeIndex === -1 || overIndex === -1) {
        return
      }

      onReorder(arrayMove(ids, activeIndex, overIndex))
    },
    [ids, onReorder]
  )

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setDrag((current) =>
      current === null
        ? current
        : { ...current, overId: event.over ? String(event.over.id) : null }
    )
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setDrag({ activeId: String(event.active.id), overId: null })
  }, [])

  // Not memoised, deliberately: every call site calls this during render and
  // passes only the resulting string on, so the identity never crosses a
  // boundary. `ids` is a fresh array on most renders anyway.
  //
  // Dragging forwards lands after the hovered row, backwards before it,
  // matching how `arrayMove` resolves the drop. Dropping a row on itself
  // changes nothing, so it gets no line.
  const dropIndicatorFor = (id: string): DropIndicator => {
    if (drag === null || drag.overId !== id || drag.activeId === id) {
      return null
    }

    const activeIndex = ids.indexOf(drag.activeId)
    const overIndex = ids.indexOf(id)

    // The rendered rows are a subsequence of `ids`, so a miss means the two
    // have gone out of step — a worksheet deleted while its tab was being
    // dragged, say. No line is the honest answer; -1 read as a position draws
    // one on the wrong side of every row instead.
    if (activeIndex === -1 || overIndex === -1) {
      return null
    }

    return activeIndex < overIndex ? 'after' : 'before'
  }

  return {
    dndContextProps: {
      collisionDetection: closestCenter,
      modifiers: axisModifiers[axis],
      onDragCancel: handleDragCancel,
      onDragEnd: handleDragEnd,
      onDragOver: handleDragOver,
      onDragStart: handleDragStart,
      sensors
    },
    dropIndicatorFor
  }
}
