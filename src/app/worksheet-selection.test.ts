import { describe, expect, it } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'
import { pickWorksheetToOpen } from './worksheet-selection'

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
