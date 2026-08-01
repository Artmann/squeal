import { formatCellValue } from './query-result-format'

// Rows are windowed, so the browser only ever sees a slice of the data. Letting
// it auto-size columns would make them jump every time the window moved, so the
// widths are computed once from the first page and pinned.
export const columnSampleSize = 100

const maximumColumnWidth = 420
const minimumColumnWidth = 80

// The body is a 12px monospace face, where every glyph is the same width. That
// makes a character count a reliable proxy for pixels without touching the DOM.
const monoCharacterWidth = 7.2
const cellPadding = 28

export const rowNumberColumnWidth = 44

export interface ColumnWidthInput {
  fieldNames: string[]
  rows: Record<string, unknown>[]
}

function widthForCharacters(characters: number): number {
  const width = Math.ceil(characters * monoCharacterWidth) + cellPadding

  return Math.min(maximumColumnWidth, Math.max(minimumColumnWidth, width))
}

/**
 * Pins a pixel width per column, measured from the header and the first page of
 * rows. Values further down the result can be wider than the sample — those
 * cells are clipped by `whitespace-nowrap` rather than being allowed to reflow
 * every other column mid-scroll.
 */
export function getColumnWidths({
  fieldNames,
  rows
}: ColumnWidthInput): Record<string, number> {
  const sample = rows.slice(0, columnSampleSize)
  const widths: Record<string, number> = {}

  for (const fieldName of fieldNames) {
    let longest = fieldName.length

    for (const row of sample) {
      const length = formatCellValue(row[fieldName]).length

      if (length > longest) {
        longest = length
      }
    }

    widths[fieldName] = widthForCharacters(longest)
  }

  return widths
}
