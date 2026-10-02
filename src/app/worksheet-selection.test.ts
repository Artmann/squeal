import { describe, expect, it } from 'vitest'

import { makeWorksheet } from './test-fixtures'
import {
  pickDatabaseForNewWorksheet,
  pickWorksheetToOpen
} from './worksheet-selection'

const worksheets = [
  makeWorksheet({ id: 'a', lastOpenedAt: null }),
  makeWorksheet({ id: 'b', lastOpenedAt: 200 }),
  makeWorksheet({ id: 'c', lastOpenedAt: 100 })
]

describe('pickWorksheetToOpen', () => {
  it('keeps the open worksheet when it still exists', () => {
    expect(pickWorksheetToOpen(worksheets, 'c')).toEqual(undefined)
  })

  it('picks the most recently opened worksheet', () => {
    expect(pickWorksheetToOpen(worksheets, undefined)).toEqual('b')
    expect(pickWorksheetToOpen(worksheets, 'gone')).toEqual('b')
  })

  it('falls back to the first worksheet when none was opened', () => {
    expect(
      pickWorksheetToOpen(
        [makeWorksheet({ id: 'a', lastOpenedAt: null })],
        undefined
      )
    ).toEqual('a')
  })

  it('returns undefined when there are no worksheets', () => {
    expect(pickWorksheetToOpen([], undefined)).toEqual(undefined)
  })
})

describe('pickDatabaseForNewWorksheet', () => {
  it('reuses the database the active worksheet runs against', () => {
    const candidates = [
      makeWorksheet({ databaseId: 'db-a', id: 'a', lastOpenedAt: 300 }),
      makeWorksheet({ databaseId: 'db-b', id: 'b', lastOpenedAt: 200 })
    ]

    expect(pickDatabaseForNewWorksheet(candidates, 'b')).toEqual('db-b')
  })

  it('falls back to the most recently opened worksheet with a database', () => {
    const candidates = [
      makeWorksheet({ databaseId: 'db-a', id: 'a', lastOpenedAt: 100 }),
      makeWorksheet({ databaseId: 'db-b', id: 'b', lastOpenedAt: 300 }),
      makeWorksheet({ databaseId: null, id: 'c', lastOpenedAt: 400 })
    ]

    expect(pickDatabaseForNewWorksheet(candidates, undefined)).toEqual('db-b')
  })

  // The active worksheet not having one yet is not a reason to start from
  // scratch — the last connection the user worked with is the better guess.
  it('falls back when the active worksheet has no database', () => {
    const candidates = [
      makeWorksheet({ databaseId: 'db-a', id: 'a', lastOpenedAt: 100 }),
      makeWorksheet({ databaseId: null, id: 'b', lastOpenedAt: 300 })
    ]

    expect(pickDatabaseForNewWorksheet(candidates, 'b')).toEqual('db-a')
  })

  it('returns undefined when no worksheet has a database', () => {
    expect(pickDatabaseForNewWorksheet(worksheets, 'b')).toEqual(undefined)
    expect(pickDatabaseForNewWorksheet([], undefined)).toEqual(undefined)
  })
})
