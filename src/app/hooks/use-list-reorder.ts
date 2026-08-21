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
import { type SortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useState } from 'react'

import { moveIds } from '../list-move'

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
  /**
   * Whether the row is travelling with the drag in flight. `useSortable` knows
   * this for the row under the cursor only, and a group drag carries rows the
   * cursor never touched.
   */
  isMoving: (id: string) => boolean
}

interface UseListReorderOptions {
  axis: 'horizontal' | 'vertical'
  ids: string[]
  onReorder: (orderedIds: string[]) => void
  /**
   * Rows the user has picked out, if the list offers that at all. Grabbing one
   * of them drags the whole group; grabbing anything else is an ordinary
   * single-row drag and leaves the selection where it is.
   */
  selectedIds?: string[]
}

// The rows this drag is carrying. A selection the dragged row is not part of
// belongs to whatever else the list does with it, not to the drag.
function movingIdsFor(
  activeId: string,
  selectedIds: string[] | undefined
): string[] {
  return selectedIds?.includes(activeId) ? selectedIds : [activeId]
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
  const { axis, ids, onReorder, selectedIds } = options

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

      const activeId = String(active.id)
      const nextIds = moveIds(
        ids,
        movingIdsFor(activeId, selectedIds),
        activeId,
        String(over.id)
      )

      // `moveIds` hands back the list it was given, by reference, for every
      // drop that means nothing: a row that left the list mid-drag, or a drop
      // onto a row that is itself travelling. Neither is worth a write.
      if (nextIds === ids) {
        return
      }

      onReorder(nextIds)
    },
    [ids, onReorder, selectedIds]
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
  // matching how `moveIds` resolves the drop. A row that is travelling with
  // the drag gets no line: dropping the group on one of its own rows changes
  // nothing, so there is nothing to point at.
  const dropIndicatorFor = (id: string): DropIndicator => {
    if (drag === null || drag.overId !== id) {
      return null
    }

    if (movingIdsFor(drag.activeId, selectedIds).includes(id)) {
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

  const isMoving = (id: string): boolean =>
    drag !== null && movingIdsFor(drag.activeId, selectedIds).includes(id)

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
    dropIndicatorFor,
    isMoving
  }
}
