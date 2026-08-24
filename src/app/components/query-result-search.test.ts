import { describe, expect, it } from 'vitest'

import {
  buildResultSearchIndex,
  findMatchOffsets,
  normalizeSearchQuery,
  splitCellText
} from './query-result-search'

describe('normalizeSearchQuery', () => {
  it('trims and lower-cases, so a pasted id with a trailing newline still matches', () => {
    expect(normalizeSearchQuery('  A3F9C2B1\n')).toEqual('a3f9c2b1')
  })

  it('answers an empty string for a whitespace-only query', () => {
    expect(normalizeSearchQuery('   ')).toEqual('')
  })
})

describe('findMatchOffsets', () => {
  it('finds every occurrence, left to right', () => {
    expect(findMatchOffsets('a-b-a-b', 'b')).toEqual([2, 6])
  })

  it('does not overlap, so aa in aaaa is two matches', () => {
    expect(findMatchOffsets('aaaa', 'aa')).toEqual([0, 2])
  })

  it('ignores case in the text', () => {
    expect(findMatchOffsets('Mia FORD', 'ford')).toEqual([4])
  })

  it('answers nothing for an empty needle', () => {
    expect(findMatchOffsets('anything', '')).toEqual([])
  })

  it('treats the needle literally rather than as a pattern', () => {
    expect(findMatchOffsets('a(b', '(')).toEqual([1])
    expect(findMatchOffsets('ab', '.')).toEqual([])
  })
})

describe('splitCellText', () => {
  it('splits a match out of its surrounding text', () => {
    expect(splitCellText('mia@example.com', 'example')).toEqual([
      { isMatch: false, text: 'mia@' },
      { isMatch: true, text: 'example' },
      { isMatch: false, text: '.com' }
    ])
  })

  it('keeps the original casing of the matched run', () => {
    expect(splitCellText('Mia Ford', 'mia')).toEqual([
      { isMatch: true, text: 'Mia' },
      { isMatch: false, text: ' Ford' }
    ])
  })

  it('splits several matches in one cell', () => {
    expect(splitCellText('a1a1', '1')).toEqual([
      { isMatch: false, text: 'a' },
      { isMatch: true, text: '1' },
      { isMatch: false, text: 'a' },
      { isMatch: true, text: '1' }
    ])
  })

  it('answers one unmatched segment when nothing matches', () => {
    expect(splitCellText('zoe', 'mia')).toEqual([
      { isMatch: false, text: 'zoe' }
    ])
  })

  it('answers one unmatched segment for an empty needle', () => {
    expect(splitCellText('zoe', '')).toEqual([{ isMatch: false, text: 'zoe' }])
  })

  it('gives up the highlight rather than mangle text whose case change resizes it', () => {
    // 'İ' lower-cases to two code units, so offsets found in the lower-cased
    // copy no longer address the original.
    expect(splitCellText('İstanbul', 'stanbul')).toEqual([
      { isMatch: false, text: 'İstanbul' }
    ])
  })

  it('always rejoins into the text it was given', () => {
    const text = 'a1a1b'

    expect(
      splitCellText(text, '1')
        .map((segment) => segment.text)
        .join('')
    ).toEqual(text)
  })
})

describe('buildResultSearchIndex', () => {
  const columnNames = ['id', 'email', 'name']
  const rows = [
    { email: 'mia@example.com', id: 'a3f9', name: 'Mia Ford' },
    { email: 'leo@example.com', id: '0c8e', name: 'Leo Ba' },
    { email: 'a3f9@x.io', id: '77bd', name: 'Ann Ro' }
  ]

  it('answers no matches and an empty needle when not searching', () => {
    expect(buildResultSearchIndex({ columnNames, query: '  ', rows })).toEqual({
      columnHasMatch: [false, false, false],
      matches: [],
      needle: ''
    })
  })

  it('reports the matching rows in order, with the first matching column of each', () => {
    expect(
      buildResultSearchIndex({ columnNames, query: 'a3f9', rows })
    ).toEqual({
      columnHasMatch: [true, true, false],
      matches: [
        { columnIndex: 0, rowIndex: 0 },
        { columnIndex: 1, rowIndex: 2 }
      ],
      needle: 'a3f9'
    })
  })

  it('ignores case in both directions', () => {
    expect(
      buildResultSearchIndex({ columnNames, query: 'MIA FORD', rows }).matches
    ).toEqual([{ columnIndex: 2, rowIndex: 0 }])
  })

  it('answers nothing when no row matches', () => {
    expect(buildResultSearchIndex({ columnNames, query: 'zoe', rows })).toEqual(
      {
        columnHasMatch: [false, false, false],
        matches: [],
        needle: 'zoe'
      }
    )
  })

  it('matches numbers and booleans by the text they display', () => {
    const index = buildResultSearchIndex({
      columnNames: ['count', 'isActive'],
      query: 'true',
      rows: [
        { count: 12, isActive: true },
        { count: 34, isActive: false }
      ]
    })

    expect(index.matches).toEqual([{ columnIndex: 1, rowIndex: 0 }])
  })

  it('matches an object cell by its stringified form, which is what the grid shows', () => {
    const index = buildResultSearchIndex({
      columnNames: ['payload'],
      query: '"a":1',
      rows: [{ payload: { a: 1 } }]
    })

    expect(index.matches).toEqual([{ columnIndex: 0, rowIndex: 0 }])
  })

  it('matches a null cell on the query null, because null is what it displays', () => {
    const index = buildResultSearchIndex({
      columnNames: ['deletedAt'],
      query: 'null',
      rows: [{ deletedAt: null }, { deletedAt: '2026-01-01' }]
    })

    expect(index.matches).toEqual([{ columnIndex: 0, rowIndex: 0 }])
  })

  it('matches a field missing from the row on the query undefined, the same way', () => {
    const index = buildResultSearchIndex({
      columnNames: ['id', 'absent'],
      query: 'undefined',
      rows: [{ id: 'a3f9' }]
    })

    expect(index.matches).toEqual([{ columnIndex: 1, rowIndex: 0 }])
  })

  it('reports the lower column for duplicate field names, and marks both columns', () => {
    // `SELECT * FROM a JOIN b` where both carry an `id`. The row is keyed by
    // name, so both columns display the same value and both match.
    const index = buildResultSearchIndex({
      columnNames: ['id', 'id'],
      query: 'a3f9',
      rows: [{ id: 'a3f9' }]
    })

    expect(index).toEqual({
      columnHasMatch: [true, true],
      matches: [{ columnIndex: 0, rowIndex: 0 }],
      needle: 'a3f9'
    })
  })

  it('survives a result whose rows are missing entirely', () => {
    expect(
      buildResultSearchIndex({ columnNames, query: 'a3f9', rows: [] })
    ).toEqual({
      columnHasMatch: [false, false, false],
      matches: [],
      needle: 'a3f9'
    })
  })
})
