import { describe, expect, it } from 'vitest'

import { columnSampleSize, getResultColumns } from './query-result-columns'

describe('getResultColumns', () => {
  describe('widths', () => {
    it('sizes a column from its widest sampled value', () => {
      const [narrow] = getResultColumns({
        fieldNames: ['id'],
        rows: [{ id: 1 }, { id: 22 }]
      })
      const [wide] = getResultColumns({
        fieldNames: ['id'],
        rows: [{ id: 1 }, { id: 'a much longer value than the others' }]
      })

      expect(wide.width).toBeGreaterThan(narrow.width)
    })

    it('never sizes a column below the minimum', () => {
      const [column] = getResultColumns({
        fieldNames: ['n'],
        rows: [{ n: 1 }]
      })

      expect(column.width).toEqual(80)
    })

    it('caps a very wide column at the maximum', () => {
      const [column] = getResultColumns({
        fieldNames: ['blob'],
        rows: [{ blob: 'x'.repeat(5000) }]
      })

      expect(column.width).toEqual(420)
    })

    it('accounts for the header when every value is short', () => {
      const [column] = getResultColumns({
        fieldNames: ['a_rather_long_column_name'],
        rows: [{ a_rather_long_column_name: 'x' }]
      })

      expect(column.width).toBeGreaterThan(80)
    })

    it('only samples the first page of rows', () => {
      const rows = [
        ...Array.from({ length: columnSampleSize }, () => ({ value: 'short' })),
        { value: 'a value far beyond the sampled page'.repeat(3) }
      ]

      const sampled = getResultColumns({ fieldNames: ['value'], rows })
      const unsampled = getResultColumns({
        fieldNames: ['value'],
        rows: [{ value: 'short' }]
      })

      expect(sampled).toEqual(unsampled)
    })

    it('returns one column per requested field, in order', () => {
      const columns = getResultColumns({
        fieldNames: ['one', 'two'],
        rows: [{ one: 'a', two: 'b' }]
      })

      expect(columns.map((column) => column.name)).toEqual(['one', 'two'])
    })
  })

  // The header has to sit over its values, and a column has no single cell to
  // copy an alignment from — so the column owns it, derived from the rows.
  describe('alignment', () => {
    it('right-aligns a column whose sampled values are all numbers', () => {
      const [column] = getResultColumns({
        fieldNames: ['total'],
        rows: [{ total: 1 }, { total: 22 }]
      })

      expect(column).toEqual({
        align: 'right',
        key: '0:total',
        name: 'total',
        width: 80
      })
    })

    // Postgres hands `bigint`, `numeric`, `decimal` and `money` over as strings,
    // so `count(*)` and money columns stay left-aligned — header and cells
    // together. Right-aligning them needs the declared column type, which the
    // adapter drops today.
    it('left-aligns a column of numbers the driver returned as strings', () => {
      const [column] = getResultColumns({
        fieldNames: ['count'],
        rows: [{ count: '1000' }, { count: '25' }]
      })

      expect(column).toEqual({
        align: 'left',
        key: '0:count',
        name: 'count',
        width: 80
      })
    })

    it('right-aligns a numeric column that also holds nulls', () => {
      const [column] = getResultColumns({
        fieldNames: ['total'],
        rows: [{ total: 1 }, { total: null }, { total: 3 }]
      })

      expect(column.align).toEqual('right')
    })

    it('left-aligns a column of strings', () => {
      const [column] = getResultColumns({
        fieldNames: ['name'],
        rows: [{ name: 'Alice' }, { name: 'Bob' }]
      })

      expect(column.align).toEqual('left')
    })

    it('left-aligns a column that mixes numbers and strings', () => {
      const [column] = getResultColumns({
        fieldNames: ['mixed'],
        rows: [{ mixed: 1 }, { mixed: 'two' }]
      })

      expect(column.align).toEqual('left')
    })

    it('left-aligns a column with nothing but nulls', () => {
      const [column] = getResultColumns({
        fieldNames: ['empty'],
        rows: [{ empty: null }, { empty: null }]
      })

      expect(column.align).toEqual('left')
    })

    it('left-aligns a column with no rows to judge from', () => {
      const [column] = getResultColumns({ fieldNames: ['unknown'], rows: [] })

      expect(column.align).toEqual('left')
    })

    // Deliberate consequence of one alignment per column, judged from one page:
    // values past the sample cannot change it. Pinned in both directions so a
    // change here is a decision rather than a surprise.
    it('judges alignment from the sampled page only', () => {
      const numericBelowSample = [
        ...Array.from({ length: columnSampleSize }, () => ({ value: null })),
        { value: 42 }
      ]
      const textBelowSample = [
        ...Array.from({ length: columnSampleSize }, () => ({ value: 1 })),
        { value: 'not a number' }
      ]

      const [nullSampled] = getResultColumns({
        fieldNames: ['value'],
        rows: numericBelowSample
      })
      const [numberSampled] = getResultColumns({
        fieldNames: ['value'],
        rows: textBelowSample
      })

      expect({
        nullSampled: nullSampled.align,
        numberSampled: numberSampled.align
      }).toEqual({ nullSampled: 'left', numberSampled: 'right' })
    })
  })

  // `SELECT * FROM a JOIN b` where both carry an `id`, or `SELECT 1 AS x, 2 AS
  // x`, produces two fields with one name. Keying by name collapsed them into a
  // single entry and gave sibling elements a duplicate React key.
  describe('duplicate field names', () => {
    it('returns one column per field, each with its own identity', () => {
      const columns = getResultColumns({
        fieldNames: ['id', 'name', 'id'],
        rows: [{ id: 1, name: 'Alice' }]
      })

      expect(columns).toEqual([
        { align: 'right', key: '0:id', name: 'id', width: 80 },
        { align: 'left', key: '1:name', name: 'name', width: 80 },
        { align: 'right', key: '2:id', name: 'id', width: 80 }
      ])
    })
  })
})
