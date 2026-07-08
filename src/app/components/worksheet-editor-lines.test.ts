import { describe, expect, it } from 'vitest'

import {
  findGutterMarkerPositions,
  findStatementLineRange
} from './worksheet-editor-lines'

const content = 'SELECT 1;\nSELECT\n  2;\nSELECT 3;'

describe('findStatementLineRange', () => {
  it('maps a single-line statement to its line', () => {
    expect(findStatementLineRange(content, { end: 9, start: 0 })).toEqual({
      endLine: 0,
      startLine: 0
    })
  })

  it('maps a multi-line statement to its line span', () => {
    expect(findStatementLineRange(content, { end: 21, start: 10 })).toEqual({
      endLine: 2,
      startLine: 1
    })
  })

  it('extends to the last line when the end is past the content', () => {
    expect(findStatementLineRange(content, { end: 99, start: 22 })).toEqual({
      endLine: 3,
      startLine: 3
    })
  })
})

describe('findGutterMarkerPositions', () => {
  it('returns the start position of every covered line', () => {
    expect(findGutterMarkerPositions(content, { end: 21, start: 10 })).toEqual([
      10, 17
    ])
  })

  it('returns an empty list when the statement is out of range', () => {
    expect(findGutterMarkerPositions('', { end: 5, start: 4 })).toEqual([])
  })
})
