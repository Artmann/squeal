import { describe, expect, it } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'
import {
  pickDatabaseForNewWorksheet,
  pickWorksheetToOpen
} from './worksheet-selection'

function createWorksheet(
  id: string,
  lastOpenedAt: number | null
): WorksheetDto {
  return {
    content: '',
    createdAt: 1,
    databaseId: null,
    id,
    lastOpenedAt,
    name: id,
    sortOrder: null
  }
}

const worksheets = [
  createWorksheet('a', null),
  createWorksheet('b', 200),
  createWorksheet('c', 100)
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
      pickWorksheetToOpen([createWorksheet('a', null)], undefined)
    ).toEqual('a')
  })

  it('returns undefined when there are no worksheets', () => {
    expect(pickWorksheetToOpen([], undefined)).toEqual(undefined)
  })
})

describe('pickDatabaseForNewWorksheet', () => {
  function withDatabase(
    worksheet: WorksheetDto,
    databaseId: string
  ): WorksheetDto {
    return { ...worksheet, databaseId }
  }

  it('reuses the database the active worksheet runs against', () => {
    const candidates = [
      withDatabase(createWorksheet('a', 300), 'db-a'),
      withDatabase(createWorksheet('b', 200), 'db-b')
    ]

    expect(pickDatabaseForNewWorksheet(candidates, 'b')).toEqual('db-b')
  })

  it('falls back to the most recently opened worksheet with a database', () => {
    const candidates = [
      withDatabase(createWorksheet('a', 100), 'db-a'),
      withDatabase(createWorksheet('b', 300), 'db-b'),
      createWorksheet('c', 400)
    ]

    expect(pickDatabaseForNewWorksheet(candidates, undefined)).toEqual('db-b')
  })

  // The active worksheet not having one yet is not a reason to start from
  // scratch — the last connection the user worked with is the better guess.
  it('falls back when the active worksheet has no database', () => {
    const candidates = [
      withDatabase(createWorksheet('a', 100), 'db-a'),
      createWorksheet('b', 300)
    ]

    expect(pickDatabaseForNewWorksheet(candidates, 'b')).toEqual('db-a')
  })

  it('returns undefined when no worksheet has a database', () => {
    expect(pickDatabaseForNewWorksheet(worksheets, 'b')).toEqual(undefined)
    expect(pickDatabaseForNewWorksheet([], undefined)).toEqual(undefined)
  })
})
