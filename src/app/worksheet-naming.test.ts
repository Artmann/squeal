import { describe, expect, it } from 'vitest'

import { makeWorksheet } from './test-fixtures'
import { getDuplicateName, getNextUntitledName } from './worksheet-naming'

describe('getNextUntitledName', () => {
  it('names the first worksheet Untitled', () => {
    expect(getNextUntitledName([])).toEqual('Untitled')
  })

  it('numbers the next untitled worksheet', () => {
    expect(getNextUntitledName([makeWorksheet({ name: 'Untitled' })])).toEqual(
      'Untitled 2'
    )
  })

  it('counts existing numbered worksheets', () => {
    expect(
      getNextUntitledName([
        makeWorksheet({ name: 'Untitled' }),
        makeWorksheet({ name: 'Untitled 2' })
      ])
    ).toEqual('Untitled 3')
  })

  it('ignores worksheets with their own names', () => {
    expect(
      getNextUntitledName([
        makeWorksheet({ name: 'Revenue' }),
        makeWorksheet({ name: 'Untitled notes' })
      ])
    ).toEqual('Untitled')
  })

  // Counting the untitled worksheets collides the moment the set has a gap.
  it('does not reuse a name after an earlier untitled worksheet is renamed', () => {
    expect(
      getNextUntitledName([
        makeWorksheet({ name: 'Revenue' }),
        makeWorksheet({ name: 'Untitled 2' })
      ])
    ).toEqual('Untitled 3')
  })

  it('does not reuse a name after an untitled worksheet is deleted', () => {
    expect(
      getNextUntitledName([
        makeWorksheet({ name: 'Untitled' }),
        makeWorksheet({ name: 'Untitled 3' })
      ])
    ).toEqual('Untitled 4')
  })

  it('goes past the highest suffix, not the count', () => {
    expect(
      getNextUntitledName([
        makeWorksheet({ name: 'Untitled' }),
        makeWorksheet({ name: 'Untitled 9' })
      ])
    ).toEqual('Untitled 10')
  })
})

describe('getDuplicateName', () => {
  it('adds copy to the name', () => {
    expect(
      getDuplicateName([makeWorksheet({ name: 'Revenue' })], 'Revenue')
    ).toEqual('Revenue copy')
  })

  it('numbers the copy when one already exists', () => {
    expect(
      getDuplicateName(
        [
          makeWorksheet({ name: 'Revenue' }),
          makeWorksheet({ name: 'Revenue copy' })
        ],
        'Revenue'
      )
    ).toEqual('Revenue copy 2')
  })

  it('goes past the highest copy, not the count', () => {
    expect(
      getDuplicateName(
        [
          makeWorksheet({ name: 'Revenue' }),
          makeWorksheet({ name: 'Revenue copy 4' })
        ],
        'Revenue'
      )
    ).toEqual('Revenue copy 5')
  })

  // "Revenue copy copy" says nothing "Revenue copy 2" does not.
  it('numbers a copy of a copy instead of stacking the word', () => {
    expect(
      getDuplicateName(
        [
          makeWorksheet({ name: 'Revenue' }),
          makeWorksheet({ name: 'Revenue copy' })
        ],
        'Revenue copy'
      )
    ).toEqual('Revenue copy 2')
  })

  it('ignores worksheets that only start with the same name', () => {
    expect(
      getDuplicateName(
        [
          makeWorksheet({ name: 'Revenue' }),
          makeWorksheet({ name: 'Revenue copy of old' })
        ],
        'Revenue'
      )
    ).toEqual('Revenue copy')
  })

  it('keeps a name that is nothing but the word copy', () => {
    expect(
      getDuplicateName([makeWorksheet({ name: ' copy' })], ' copy')
    ).toEqual(' copy copy')
  })
})
