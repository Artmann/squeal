/**
 * Moves `movingIds` to where they were dropped and returns the whole new
 * order. One id is the ordinary single-row drag; several is a multi-selection
 * dragged as a block.
 *
 * The block lands after `overId` when it was dragged forwards and before it
 * when it was dragged backwards, which is the rule the drop indicator draws —
 * `activeId` is the row under the cursor's grip, so it is what decides the
 * direction even when the rest of the block sits on the other side of it.
 *
 * Anything inconsistent answers with the order it was given rather than a
 * guess: a row deleted mid-drag, a drop onto a row that is itself moving, an
 * id that is no longer in the list. Returning the list unchanged is a drag
 * that did nothing, which is what the user sees anyway when they let go
 * somewhere that means nothing.
 */
export function moveIds(
  orderedIds: string[],
  movingIds: string[],
  activeId: string,
  overId: string
): string[] {
  const moving = new Set(movingIds)

  if (moving.has(overId)) {
    return orderedIds
  }

  const activeIndex = orderedIds.indexOf(activeId)
  const overIndex = orderedIds.indexOf(overId)

  if (activeIndex === -1 || overIndex === -1) {
    return orderedIds
  }

  // Read off the list rather than off `movingIds`, so the block keeps the
  // order it has on screen no matter what order it was selected in.
  const block = orderedIds.filter((id) => moving.has(id))
  const rest = orderedIds.filter((id) => !moving.has(id))

  const targetIndex = rest.indexOf(overId)
  const insertAt = activeIndex < overIndex ? targetIndex + 1 : targetIndex

  return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)]
}
