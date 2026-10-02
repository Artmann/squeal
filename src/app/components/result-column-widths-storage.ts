// The widths the user dragged the columns of each result to, kept between
// restarts. Only the columns that were resized are stored; every other column
// keeps the width `getResultColumns` measures for it.

export const columnWidthsStorageKey = 'ui:result-column-widths:v1'

// Results whose widths are remembered at all. The least recently resized one
// is dropped first, so the stored value stays a few kilobytes however many
// queries are run.
export const maximumStoredResults = 100

// Keyed by `ResultColumn.key`, which is the column's position plus its name.
export type ColumnWidths = Record<string, number>

/**
 * The widths stored for one result, or an empty object when there are none or
 * storage cannot be read -- a column width is never worth failing to render
 * over.
 */
export function readColumnWidths(queryId: string): ColumnWidths {
  return readAllColumnWidths().get(queryId) ?? {}
}

/**
 * Stores a result's widths as the most recently resized, and drops the least
 * recently resized beyond the cap.
 */
export function writeColumnWidths(queryId: string, widths: ColumnWidths): void {
  const all = readAllColumnWidths()

  // Deleting first moves the entry to the end of the insertion order, which is
  // what makes the first key the least recently resized.
  all.delete(queryId)
  all.set(queryId, widths)

  for (const oldest of all.keys()) {
    if (all.size <= maximumStoredResults) {
      break
    }

    all.delete(oldest)
  }

  try {
    // An array rather than an object keyed by id, so the order that decides
    // which entry goes first survives the round trip.
    const persisted = [...all].map(([id, entryWidths]) => ({
      queryId: id,
      widths: entryWidths
    }))

    localStorage.setItem(columnWidthsStorageKey, JSON.stringify(persisted))
  } catch (error) {
    // The widths still apply for this session.
    console.warn('Could not save the result column widths.', error)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseEntry(
  entry: unknown
): { queryId: string; widths: ColumnWidths } | null {
  if (!isRecord(entry)) {
    return null
  }

  const { queryId, widths } = entry

  if (typeof queryId !== 'string' || !isRecord(widths)) {
    return null
  }

  const parsedWidths: ColumnWidths = {}

  for (const [columnKey, width] of Object.entries(widths)) {
    if (isWidth(width)) {
      parsedWidths[columnKey] = width
    }
  }

  return { queryId, widths: parsedWidths }
}

/**
 * Reads every stored result. Entries that do not have the expected shape are
 * dropped one at a time rather than taking the rest with them, and anything
 * unreadable at all comes back empty.
 */
function readAllColumnWidths(): Map<string, ColumnWidths> {
  try {
    const stored = localStorage.getItem(columnWidthsStorageKey)

    if (!stored) {
      return new Map()
    }

    const parsed: unknown = JSON.parse(stored)

    if (!Array.isArray(parsed)) {
      return new Map()
    }

    const all = new Map<string, ColumnWidths>()

    for (const entry of parsed.slice(-maximumStoredResults)) {
      const parsedEntry = parseEntry(entry)

      if (parsedEntry) {
        all.set(parsedEntry.queryId, parsedEntry.widths)
      }
    }

    return all
  } catch (error) {
    console.warn('Could not read the stored result column widths.', error)

    return new Map()
  }
}
