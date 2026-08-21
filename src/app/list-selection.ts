/**
 * A multi-row selection in a list: the rows themselves, plus the row a
 * shift-click measures its range from. `null` stands for no selection at all,
 * so an empty `ids` is unrepresentable rather than something every reader has
 * to rule out.
 */
export interface ListSelection {
  anchorId: string
  ids: string[]
}

/**
 * Shift-click: the range from the anchor to the clicked row, in list order.
 * The anchor stays put, so shift-clicking again re-measures from the same row
 * instead of growing the range one click at a time.
 *
 * With nothing to measure from — no selection, or an anchor whose row has
 * since gone — the clicked row becomes the new anchor and the whole selection.
 */
export function extendSelection(
  selection: ListSelection | null,
  id: string,
  orderedIds: string[]
): ListSelection | null {
  const index = orderedIds.indexOf(id)

  // A click can only land on a rendered row, so this is drift rather than a
  // case: the row went away between the render and the click. Leaving the
  // selection alone is the honest answer.
  if (index === -1) {
    return selection
  }

  const anchorIndex = selection ? orderedIds.indexOf(selection.anchorId) : -1

  if (!selection || anchorIndex === -1) {
    return replaceSelection(id)
  }

  const from = Math.min(anchorIndex, index)
  const to = Math.max(anchorIndex, index)

  return {
    anchorId: selection.anchorId,
    ids: orderedIds.slice(from, to + 1)
  }
}

/**
 * Drops the rows that are no longer in the list. Called with the selection on
 * its way out of the store rather than on a schedule, so a worksheet deleted
 * in another window cannot leave an id behind for a later drag or delete to
 * act on.
 */
export function pruneSelection(
  selection: ListSelection | null,
  existingIds: string[]
): ListSelection | null {
  if (!selection) {
    return null
  }

  const existing = new Set(existingIds)
  const ids = selection.ids.filter((id) => existing.has(id))

  const anchorId = existing.has(selection.anchorId)
    ? selection.anchorId
    : ids[0]

  if (anchorId === undefined) {
    return null
  }

  return { anchorId, ids }
}

/** A plain click: this row, and the next shift-click measures from it. */
export function replaceSelection(id: string): ListSelection {
  return { anchorId: id, ids: [id] }
}

/**
 * Command- or control-click: adds the row or takes it out again. Either way it
 * becomes the anchor — it is the row the user last pointed at, so it is what a
 * shift-click after it should measure from. Taking out the last row leaves no
 * selection rather than an empty one.
 */
export function toggleSelection(
  selection: ListSelection | null,
  id: string
): ListSelection | null {
  if (!selection) {
    return replaceSelection(id)
  }

  if (!selection.ids.includes(id)) {
    return { anchorId: id, ids: [...selection.ids, id] }
  }

  const ids = selection.ids.filter((selectedId) => selectedId !== id)

  if (ids.length === 0) {
    return null
  }

  return { anchorId: id, ids }
}
