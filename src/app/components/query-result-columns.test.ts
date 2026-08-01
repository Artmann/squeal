import { describe, expect, it } from 'vitest'

import { columnSampleSize, getColumnWidths } from './query-result-columns'

describe('getColumnWidths', () => {
  it('sizes a column from its widest sampled value', () => {
    const narrow = getColumnWidths({
      fieldNames: ['id'],
      rows: [{ id: 1 }, { id: 22 }]
    })
    const wide = getColumnWidths({
      fieldNames: ['id'],
      rows: [{ id: 1 }, { id: 'a much longer value than the others' }]
    })

    expect(wide.id).toBeGreaterThan(narrow.id)
  })

  it('never sizes a column below the minimum', () => {
    const widths = getColumnWidths({ fieldNames: ['n'], rows: [{ n: 1 }] })

    expect(widths.n).toEqual(80)
  })

  it('caps a very wide column at the maximum', () => {
    const widths = getColumnWidths({
      fieldNames: ['blob'],
      rows: [{ blob: 'x'.repeat(5000) }]
    })

    expect(widths.blob).toEqual(420)
  })

  it('accounts for the header when every value is short', () => {
    const widths = getColumnWidths({
      fieldNames: ['a_rather_long_column_name'],
      rows: [{ a_rather_long_column_name: 'x' }]
    })

    expect(widths.a_rather_long_column_name).toBeGreaterThan(80)
  })

  it('only samples the first page of rows', () => {
    const rows = [
      ...Array.from({ length: columnSampleSize }, () => ({ value: 'short' })),
      { value: 'a value far beyond the sampled page'.repeat(3) }
    ]

    const sampled = getColumnWidths({ fieldNames: ['value'], rows })
    const unsampled = getColumnWidths({
      fieldNames: ['value'],
      rows: [{ value: 'short' }]
    })

    expect(sampled).toEqual(unsampled)
  })

  it('sizes every requested column', () => {
    const widths = getColumnWidths({
      fieldNames: ['one', 'two'],
      rows: [{ one: 'a', two: 'b' }]
    })

    expect(Object.keys(widths)).toEqual(['one', 'two'])
  })
})
