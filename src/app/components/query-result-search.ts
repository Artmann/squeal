// Find-in-results, the matching half. Pure: no React, no DOM.
//
// Everything here matches against `formatCellValue`'s output rather than the
// raw driver value, so find agrees with the string the user can actually see --
// dates as ISO strings, JSON columns stringified, `bytea` as
// `{"type":"Buffer",...}`, and Postgres bigint/numeric/money as strings. The
// same rule is why a search for `null` matches a null cell: `null` is what the
// cell displays and what Copy copies.
import { formatCellValue } from './query-result-format'

export interface CellTextSegment {
  isMatch: boolean
  text: string
}

export interface ResultRowMatch {
  // The first matching cell in the row, which is the scroll target.
  columnIndex: number
  // An index into `result.rows` -- always a source index, never a position in a
  // filtered view.
  rowIndex: number
}

export interface ResultSearchIndex {
  // Per column index, whether any row matches in it.
  columnHasMatch: boolean[]
  // The matching rows, ascending by `rowIndex`. Empty when not searching.
  matches: ResultRowMatch[]
  // The needle the index was built from: trimmed and lower-cased. An empty
  // string means "not searching", which is how callers skip the whole feature
  // without a second flag.
  needle: string
}

interface ResultSearchInput {
  // Column names in column order, duplicates included.
  columnNames: string[]
  query: string
  rows: Record<string, unknown>[]
}

/**
 * The comparable form of what the user typed.
 *
 * Trimming costs the ability to search for a leading or trailing space and buys
 * the case that actually happens: a pasted id carrying a trailing newline.
 */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

/**
 * Where `needle` occurs in `text`, non-overlapping and left to right, so `aa`
 * in `aaaa` is two matches rather than three. `needle` must already be
 * normalized.
 *
 * Matching is literal: a pasted value carrying an unescaped `(` would throw if
 * this compiled a regular expression.
 */
export function findMatchOffsets(text: string, needle: string): number[] {
  if (needle === '') {
    return []
  }

  const haystack = text.toLowerCase()
  const offsets: number[] = []

  let from = 0

  while (from <= haystack.length - needle.length) {
    const offset = haystack.indexOf(needle, from)

    if (offset === -1) {
      break
    }

    offsets.push(offset)
    from = offset + needle.length
  }

  return offsets
}

/**
 * Splits displayed cell text into matched and unmatched runs, in order. The
 * segments always rejoin into the original text, so rendering them cannot
 * change what the cell says.
 */
export function splitCellText(text: string, needle: string): CellTextSegment[] {
  // Offsets are found in the lower-cased text and then used to slice the
  // original, which only lines up while lower-casing preserves length. A few
  // characters break that (`I` with a dot above lower-cases to two), and
  // slicing on a shifted offset would render mangled text. Such a cell still
  // counts as a match; it just does not get the highlight.
  if (needle === '' || text.toLowerCase().length !== text.length) {
    return [{ isMatch: false, text }]
  }

  const offsets = findMatchOffsets(text, needle)

  if (offsets.length === 0) {
    return [{ isMatch: false, text }]
  }

  const segments: CellTextSegment[] = []

  let cursor = 0

  for (const offset of offsets) {
    if (offset > cursor) {
      segments.push({ isMatch: false, text: text.slice(cursor, offset) })
    }

    segments.push({
      isMatch: true,
      text: text.slice(offset, offset + needle.length)
    })

    cursor = offset + needle.length
  }

  if (cursor < text.length) {
    segments.push({ isMatch: false, text: text.slice(cursor) })
  }

  return segments
}

/**
 * Every row of a result that matches the query, in render order, plus which
 * columns hold a match anywhere.
 *
 * A row is the unit of navigation rather than an occurrence: a one-character
 * search over a full result has tens of thousands of occurrences but at most
 * `rows.length` rows, so this bounds the list by construction -- and landing on
 * the row is what someone pasting an id is asking for.
 *
 * Character offsets are deliberately not stored. Only the windowed rows are
 * ever painted, so `splitCellText` runs for those during render instead of
 * keeping offsets for every cell in the result.
 */
export function buildResultSearchIndex({
  columnNames,
  query,
  rows
}: ResultSearchInput): ResultSearchIndex {
  const columnHasMatch = columnNames.map(() => false)
  const needle = normalizeSearchQuery(query)

  if (needle === '') {
    return { columnHasMatch, matches: [], needle }
  }

  const matches: ResultRowMatch[] = []

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]

    let firstColumnIndex = -1

    for (
      let columnIndex = 0;
      columnIndex < columnNames.length;
      columnIndex += 1
    ) {
      // Read by name at this position, which is exactly what the cell render
      // path does. For a result carrying two identically named fields both
      // columns therefore report the same match -- correct, because both
      // columns display the same value. The name-keying bug behind that is the
      // grid's, and find must not paper over it.
      const text = formatCellValue(row?.[columnNames[columnIndex]])

      if (!text.toLowerCase().includes(needle)) {
        continue
      }

      columnHasMatch[columnIndex] = true

      if (firstColumnIndex === -1) {
        firstColumnIndex = columnIndex
      }
    }

    if (firstColumnIndex !== -1) {
      matches.push({ columnIndex: firstColumnIndex, rowIndex })
    }
  }

  return { columnHasMatch, matches, needle }
}

/**
 * What the grid needs to paint a search: the index, which match is being
 * jumped to, and whether non-matching rows are hidden.
 *
 * `query` is what the user typed, kept alongside the normalized `needle`
 * because the empty state quotes it back and a lower-cased echo of someone's
 * own typing reads as a bug.
 */
export interface ResultSearchView {
  // Ordinal into `matches`, or -1 when there is nothing to jump to.
  activeIndex: number
  columnHasMatch: boolean[]
  isFiltering: boolean
  matches: ResultRowMatch[]
  needle: string
  query: string
}

export interface AppliedSearch {
  // The match being jumped to, if any, resolved from the view's ordinal.
  activeMatch: ResultRowMatch | undefined
  // Its index into `result.rows`, or -1.
  activeRowIndex: number
  // Its index in the virtualizer's coordinate space, or -1. The two differ
  // while filtering, where the virtualizer counts matches rather than rows.
  activeVisibleIndex: number
  isFiltering: boolean
  needle: string
  // The one place a virtualizer index becomes an index into `result.rows`.
  toSourceIndex: (visibleIndex: number) => number
  visibleRowCount: number
}

const noMatches: ResultRowMatch[] = []

/**
 * What a search view means for a grid of `rowCount` rows: which rows to render,
 * how to address them, and which cell is the one being jumped to.
 *
 * Pulled out of the grid because the addressing is the part that goes wrong
 * quietly. While filtering, a virtualizer index is a position in the match list
 * rather than a row, and every read of the row -- its number, its cells, its
 * copy actions -- has to go through `toSourceIndex`. A missed call site shows a
 * different row's data with nothing to say so, which is worth a test that does
 * not need a rendered table.
 */
export function applySearchToRows(
  rowCount: number,
  search: ResultSearchView | undefined
): AppliedSearch {
  const needle = search?.needle ?? ''
  const matches = search?.matches ?? noMatches
  const isFiltering = search?.isFiltering === true && needle !== ''

  const activeMatch =
    search === undefined || search.activeIndex < 0
      ? undefined
      : matches[search.activeIndex]

  const toSourceIndex = (visibleIndex: number): number => {
    if (!isFiltering) {
      return visibleIndex
    }

    const match = matches[visibleIndex]

    return match === undefined ? visibleIndex : match.rowIndex
  }

  return {
    activeMatch,
    activeRowIndex: activeMatch?.rowIndex ?? -1,
    activeVisibleIndex:
      activeMatch === undefined
        ? -1
        : isFiltering
          ? (search?.activeIndex ?? -1)
          : activeMatch.rowIndex,
    isFiltering,
    needle,
    toSourceIndex,
    visibleRowCount: isFiltering ? matches.length : rowCount
  }
}
