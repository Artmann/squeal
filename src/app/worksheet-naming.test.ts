import { describe, expect, it } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'

import { getNextUntitledName } from './worksheet-naming'

function worksheet(name: string): WorksheetDto {
  return {
    content: '',
    createdAt: 0,
    databaseId: '',
    id: name,
    lastOpenedAt: 0,
    name,
    sortOrder: 0
  }
}

describe('getNextUntitledName', () => {
  it('names the first worksheet Untitled', () => {
    expect(getNextUntitledName([])).toEqual('Untitled')
  })

  it('numbers the next untitled worksheet', () => {
    expect(getNextUntitledName([worksheet('Untitled')])).toEqual('Untitled 2')
  })

  it('counts existing numbered worksheets', () => {
    expect(
      getNextUntitledName([worksheet('Untitled'), worksheet('Untitled 2')])
    ).toEqual('Untitled 3')
  })

  it('ignores worksheets with their own names', () => {
    expect(
      getNextUntitledName([worksheet('Revenue'), worksheet('Untitled notes')])
    ).toEqual('Untitled')
  })
})
