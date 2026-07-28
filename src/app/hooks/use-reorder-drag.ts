import {
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useCallback } from 'react'

interface UseReorderDragOptions {
  ids: string[]
  onReorder: (orderedIds: string[]) => void
  resetDropIndicator: () => void
}

// Shared dnd-kit wiring for the sortable sidebar lists: a pointer sensor with
// a small activation distance, and a drag-end handler that resets the drop
// indicator and maps the drop position to a fully reordered id list.
export function useReorderDrag(options: UseReorderDragOptions) {
  const { ids, onReorder, resetDropIndicator } = options

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      resetDropIndicator()

      if (!over || active.id === over.id) {
        return
      }

      const orderedIds = arrayMove(
        ids,
        ids.indexOf(String(active.id)),
        ids.indexOf(String(over.id))
      )

      onReorder(orderedIds)
    },
    [ids, onReorder, resetDropIndicator]
  )

  return { handleDragEnd, sensors }
}
