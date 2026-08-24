import { describe, expect, it } from 'vitest'

import {
  applySearchToRows,
  buildResultSearchIndex,
  findMatchOffsets,
  normalizeSearchQuery,
  type ResultSearchView,
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

describe('applySearchToRows', () => {
  const view = (
    overrides: Partial<ResultSearchView> = {}
  ): ResultSearchView => ({
    activeIndex: 0,
    columnHasMatch: [true, false],
    isFiltering: false,
    // Rows 2 and 5 matched, in column 1 and column 0.
    matches: [
      { columnIndex: 1, rowIndex: 2 },
      { columnIndex: 0, rowIndex: 5 }
    ],
    needle: 'mia',
    query: 'mia',
    ...overrides
  })

  it('leaves every row addressed by itself when there is no search', () => {
    const applied = applySearchToRows(10, undefined)

    expect({
      activeRowIndex: applied.activeRowIndex,
      activeVisibleIndex: applied.activeVisibleIndex,
      isFiltering: applied.isFiltering,
      needle: applied.needle,
      third: applied.toSourceIndex(3),
      visibleRowCount: applied.visibleRowCount
    }).toEqual({
      activeRowIndex: -1,
      activeVisibleIndex: -1,
      isFiltering: false,
      needle: '',
      third: 3,
      visibleRowCount: 10
    })
  })

  it('counts every row and addresses them directly while not filtering', () => {
    const applied = applySearchToRows(10, view())

    expect({
      activeMatch: applied.activeMatch,
      activeRowIndex: applied.activeRowIndex,
      activeVisibleIndex: applied.activeVisibleIndex,
      first: applied.toSourceIndex(0),
      seventh: applied.toSourceIndex(7),
      visibleRowCount: applied.visibleRowCount
    }).toEqual({
      activeMatch: { columnIndex: 1, rowIndex: 2 },
      activeRowIndex: 2,
      // Not filtering, so the virtualizer counts rows and the match's own row
      // index is the position it wants.
      activeVisibleIndex: 2,
      first: 0,
      seventh: 7,
      visibleRowCount: 10
    })
  })

  // The assertion the rendered table cannot make: while filtering, position 1
  // is row 5, and every read of the row has to go through this.
  it('counts matches and translates position to row while filtering', () => {
    const applied = applySearchToRows(10, view({ isFiltering: true }))

    expect({
      first: applied.toSourceIndex(0),
      second: applied.toSourceIndex(1),
      visibleRowCount: applied.visibleRowCount
    }).toEqual({ first: 2, second: 5, visibleRowCount: 2 })
  })

  it('puts the active match at its position in the filtered list', () => {
    const applied = applySearchToRows(
      10,
      view({ activeIndex: 1, isFiltering: true })
    )

    expect({
      activeRowIndex: applied.activeRowIndex,
      activeVisibleIndex: applied.activeVisibleIndex
    }).toEqual({ activeRowIndex: 5, activeVisibleIndex: 1 })
  })

  // An empty query with the toggle on must not hide every row: there is nothing
  // to filter by yet.
  it('does not filter on an empty needle even with the toggle on', () => {
    const applied = applySearchToRows(
      10,
      view({ isFiltering: true, matches: [], needle: '', query: '' })
    )

    expect({
      isFiltering: applied.isFiltering,
      visibleRowCount: applied.visibleRowCount
    }).toEqual({ isFiltering: false, visibleRowCount: 10 })
  })

  it('has no active match when the ordinal says there is none', () => {
    const applied = applySearchToRows(10, view({ activeIndex: -1 }))

    expect({
      activeMatch: applied.activeMatch,
      activeRowIndex: applied.activeRowIndex,
      activeVisibleIndex: applied.activeVisibleIndex
    }).toEqual({
      activeMatch: undefined,
      activeRowIndex: -1,
      activeVisibleIndex: -1
    })
  })

  it('falls back to the position itself for a match that is not there', () => {
    const applied = applySearchToRows(10, view({ isFiltering: true }))

    expect(applied.toSourceIndex(9)).toEqual(9)
  })
})
