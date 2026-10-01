// Where the caret, the selection and the scroll position of each worksheet are
// kept between restarts. Plain data only -- turning it into a CodeMirror
// selection, and reading it back out of a live editor, is
// `worksheet-editor-view`'s job, so this half can be tested without one.

export const editorViewsStorageKey = 'ui:editor-views:v1'

// Worksheets whose view is remembered at all. The least recently touched one
// is dropped first, so a user who has visited hundreds of worksheets keeps the
// ones they are working in, and the stored value stays a few kilobytes.
export const maximumStoredEditorViews = 50

// Beyond this many cursors only the main one is kept. A selection that large is
// a one-off edit, not a place to come back to, and it would otherwise make one
// entry as big as all the others together.
export const maximumStoredSelectionRanges = 100

export interface StoredEditorView {
  // Index into `ranges`, as `EditorSelection.mainIndex`.
  main: number
  ranges: StoredSelectionRange[]
  scroll: StoredScroll
}

// The scroll position as the line at the top of the editor plus how far past
// its top edge the editor is scrolled, rather than a plain pixel offset. The
// line is what the user was looking at; pixels only mean the same thing while
// every line above it keeps its height.
export interface StoredScroll {
  offset: number
  position: number
}

export interface StoredSelectionRange {
  anchor: number
  head: number
}

export type StoredEditorViews = Map<string, StoredEditorView>

export const topOfDocument: StoredScroll = { offset: 0, position: 0 }

/**
 * Fits a stored view to the document it is restored into. The content may have
 * changed since it was saved -- edited in another session, or cut short by a
 * failed save -- so every offset is held to the current length rather than
 * trusted.
 */
export function clampEditorView(
  view: StoredEditorView,
  documentLength: number
): StoredEditorView {
  const clampPosition = (position: number): number =>
    Math.min(Math.max(position, 0), documentLength)

  return {
    main: Math.min(Math.max(view.main, 0), view.ranges.length - 1),
    ranges: view.ranges.map((range) => ({
      anchor: clampPosition(range.anchor),
      head: clampPosition(range.head)
    })),
    scroll: {
      offset: view.scroll.position > documentLength ? 0 : view.scroll.offset,
      position: clampPosition(view.scroll.position)
    }
  }
}

/**
 * Reads the stored views. Entries that do not have the expected shape are
 * dropped one at a time rather than taking the rest with them, and anything
 * unreadable at all comes back empty -- a caret is never worth failing to boot
 * over.
 */
export function readStoredEditorViews(): StoredEditorViews {
  try {
    const stored = localStorage.getItem(editorViewsStorageKey)

    if (!stored) {
      return new Map()
    }

    const parsed: unknown = JSON.parse(stored)

    if (!Array.isArray(parsed)) {
      return new Map()
    }

    const views: StoredEditorViews = new Map()

    for (const entry of parsed.slice(-maximumStoredEditorViews)) {
      const view = parseEntry(entry)

      if (view) {
        views.set(view.worksheetId, view.view)
      }
    }

    return views
  } catch (error) {
    console.warn('Could not read the stored editor positions.', error)

    return new Map()
  }
}

/**
 * Records a worksheet's view as the most recently touched one, and drops the
 * least recently touched beyond the cap.
 */
export function rememberEditorView(
  views: StoredEditorViews,
  worksheetId: string,
  view: StoredEditorView
): void {
  const bounded =
    view.ranges.length > maximumStoredSelectionRanges
      ? { main: 0, ranges: [view.ranges[view.main]], scroll: view.scroll }
      : view

  // Deleting first moves the entry to the end of the insertion order, which is
  // what makes the first key the least recently touched.
  views.delete(worksheetId)
  views.set(worksheetId, bounded)

  for (const oldest of views.keys()) {
    if (views.size <= maximumStoredEditorViews) {
      break
    }

    views.delete(oldest)
  }
}

export function writeStoredEditorViews(views: StoredEditorViews): void {
  try {
    // An array rather than an object keyed by id, so the order that decides
    // which entry goes first survives the round trip whatever the ids look
    // like.
    const persisted = [...views].map(([worksheetId, view]) => ({
      ...view,
      worksheetId
    }))

    localStorage.setItem(editorViewsStorageKey, JSON.stringify(persisted))
  } catch (error) {
    // A caret that does not survive a restart is a much smaller problem than a
    // crash on every keystroke.
    console.warn('Could not save the editor positions.', error)
  }
}

function isOffset(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEntry(
  entry: unknown
): { view: StoredEditorView; worksheetId: string } | null {
  if (!isRecord(entry)) {
    return null
  }

  const { main, ranges, scroll, worksheetId } = entry

  if (typeof worksheetId !== 'string' || !isOffset(main)) {
    return null
  }

  const parsedRanges = parseRanges(ranges, main)
  const parsedScroll = parseScroll(scroll)

  if (parsedRanges === null || parsedScroll === null) {
    return null
  }

  return {
    view: { main, ranges: parsedRanges, scroll: parsedScroll },
    worksheetId
  }
}

// Null unless every range is valid and `main` points at one of them.
function parseRanges(
  ranges: unknown,
  main: number
): StoredSelectionRange[] | null {
  if (
    !Array.isArray(ranges) ||
    ranges.length === 0 ||
    ranges.length > maximumStoredSelectionRanges ||
    main >= ranges.length
  ) {
    return null
  }

  const parsedRanges: StoredSelectionRange[] = []

  for (const range of ranges) {
    if (!isRecord(range) || !isOffset(range.anchor) || !isOffset(range.head)) {
      return null
    }

    parsedRanges.push({ anchor: range.anchor, head: range.head })
  }

  return parsedRanges
}

function parseScroll(scroll: unknown): StoredScroll | null {
  if (
    !isRecord(scroll) ||
    !isOffset(scroll.position) ||
    typeof scroll.offset !== 'number' ||
    !Number.isFinite(scroll.offset)
  ) {
    return null
  }

  return { offset: scroll.offset, position: scroll.position }
}
