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

interface ResultColumnsInput {
  fieldNames: string[]
  rows: Record<string, unknown>[]
}

interface ResultFieldNamesInput {
  fields: { name: string }[]
  rows: Record<string, unknown>[]
}

export interface ResultColumn {
  align: 'left' | 'right'
  // Position, not name: a result can carry two fields with one name (`SELECT *
  // FROM a JOIN b` where both have an `id`), and nothing upstream forbids it —
  // so the name is not usable as an identity or a React key.
  key: string
  name: string
  width: number
}

function widthForCharacters(characters: number): number {
  const width = Math.ceil(characters * monoCharacterWidth) + cellPadding

  return Math.min(maximumColumnWidth, Math.max(minimumColumnWidth, width))
}

/**
 * Describes each column of a result: its identity, its pinned pixel width, and
 * the alignment its header and cells share.
 *
 * The width is measured from the header and the first page of rows. Values
 * further down the result can be wider than the sample — those cells are
 * clipped by `whitespace-nowrap` rather than being allowed to reflow every
 * other column mid-scroll. The alignment is inferred from that same page for
 * the same reason, so a column holding numbers throughout the sample and text
 * further down keeps the alignment the sample implied, and a column whose whole
 * sample is null is left-aligned even if numbers appear later.
 *
 * Only values the driver hands over as JS numbers count. Postgres returns
 * `bigint`, `numeric`, `decimal` and `money` as strings, so those columns stay
 * left-aligned — header and cells together, which is the mismatch this exists to
 * remove. Right-aligning them needs the column's declared type, which the
 * adapter currently drops.
 */
export function getResultColumns({
  fieldNames,
  rows
}: ResultColumnsInput): ResultColumn[] {
  const sample = rows.slice(0, columnSampleSize)

  return fieldNames.map((fieldName, index) => {
    let everyValueIsNumeric = true
    let longest = fieldName.length
    let sawValue = false

    for (const row of sample) {
      const value = row[fieldName]
      const length = formatCellValue(value).length

      if (length > longest) {
        longest = length
      }

      // Nulls do not vote on alignment: a numeric column keeps its alignment
      // through them, which is what stops a null from hanging off the left edge
      // of a column of right-aligned numbers.
      if (value === null || value === undefined) {
        continue
      }

      sawValue = true

      if (typeof value !== 'number') {
        everyValueIsNumeric = false
      }
    }

    return {
      align: sawValue && everyValueIsNumeric ? 'right' : 'left',
      key: `${index}:${fieldName}`,
      name: fieldName,
      width: widthForCharacters(longest)
    }
  })
}

/**
 * The column names of a result, in column order, duplicates included.
 *
 * Falls back to the first row's keys when the adapter returned rows without
 * field metadata, so a fields/rows desync can never blank out the columns.
 */
export function getResultFieldNames({
  fields,
  rows
}: ResultFieldNamesInput): string[] {
  if (fields.length > 0) {
    return fields.map((field) => field.name)
  }

  return Object.keys(rows[0] ?? {})
}
