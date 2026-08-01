import { describe, expect, it } from 'vitest'

import {
  isSameCursorPosition,
  toCursorPosition
} from './worksheet-editor-cursor'

describe('toCursorPosition', () => {
  it('reports line 1 column 1 at the start of the document', () => {
    expect(toCursorPosition({ from: 0, number: 1 }, 0)).toEqual({
      column: 1,
      line: 1,
      offset: 0
    })
  })

  it('counts the column from the start of the line', () => {
    expect(toCursorPosition({ from: 0, number: 1 }, 6)).toEqual({
      column: 7,
      line: 1,
      offset: 6
    })
  })

  it('keeps the offset while resetting the column on later lines', () => {
    // "select 1;\nselect 2;" — the cursor sits after "select" on line two.
    expect(toCursorPosition({ from: 10, number: 2 }, 16)).toEqual({
      column: 7,
      line: 2,
      offset: 16
    })
  })
})

describe('isSameCursorPosition', () => {
  it('treats a missing previous position as a change', () => {
    expect(
      isSameCursorPosition(null, { column: 1, line: 1, offset: 0 })
    ).toEqual(false)
  })

  it('matches identical positions', () => {
    expect(
      isSameCursorPosition(
        { column: 7, line: 2, offset: 16 },
        { column: 7, line: 2, offset: 16 }
      )
    ).toEqual(true)
  })

  it('sees a moved cursor on the same offset', () => {
    expect(
      isSameCursorPosition(
        { column: 7, line: 2, offset: 16 },
        { column: 17, line: 1, offset: 16 }
      )
    ).toEqual(false)
  })
})
