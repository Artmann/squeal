import { describe, expect, it } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'

import { getDuplicateName, getNextUntitledName } from './worksheet-naming'

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

  // Counting the untitled worksheets collides the moment the set has a gap.
  it('does not reuse a name after an earlier untitled worksheet is renamed', () => {
    expect(
      getNextUntitledName([worksheet('Revenue'), worksheet('Untitled 2')])
    ).toEqual('Untitled 3')
  })

  it('does not reuse a name after an untitled worksheet is deleted', () => {
    expect(
      getNextUntitledName([worksheet('Untitled'), worksheet('Untitled 3')])
    ).toEqual('Untitled 4')
  })

  it('goes past the highest suffix, not the count', () => {
    expect(
      getNextUntitledName([worksheet('Untitled'), worksheet('Untitled 9')])
    ).toEqual('Untitled 10')
  })
})

describe('getDuplicateName', () => {
  it('adds copy to the name', () => {
    expect(getDuplicateName([worksheet('Revenue')], 'Revenue')).toEqual(
      'Revenue copy'
    )
  })

  it('numbers the copy when one already exists', () => {
    expect(
      getDuplicateName(
        [worksheet('Revenue'), worksheet('Revenue copy')],
        'Revenue'
      )
    ).toEqual('Revenue copy 2')
  })

  it('goes past the highest copy, not the count', () => {
    expect(
      getDuplicateName(
        [worksheet('Revenue'), worksheet('Revenue copy 4')],
        'Revenue'
      )
    ).toEqual('Revenue copy 5')
  })

  // "Revenue copy copy" says nothing "Revenue copy 2" does not.
  it('numbers a copy of a copy instead of stacking the word', () => {
    expect(
      getDuplicateName(
        [worksheet('Revenue'), worksheet('Revenue copy')],
        'Revenue copy'
      )
    ).toEqual('Revenue copy 2')
  })

  it('ignores worksheets that only start with the same name', () => {
    expect(
      getDuplicateName(
        [worksheet('Revenue'), worksheet('Revenue copy of old')],
        'Revenue'
      )
    ).toEqual('Revenue copy')
  })

  it('keeps a name that is nothing but the word copy', () => {
    expect(getDuplicateName([worksheet(' copy')], ' copy')).toEqual(
      ' copy copy'
    )
  })
})
