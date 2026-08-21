import { describe, expect, it } from 'vitest'

import { moveIds } from './list-move'

const ids = ['a', 'b', 'c', 'd', 'e']

describe('moveIds', () => {
  it('lands a row dragged forwards after the row it was dropped on', () => {
    expect(moveIds(ids, ['a'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('lands a row dragged backwards before the row it was dropped on', () => {
    expect(moveIds(ids, ['d'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c', 'e'])
  })

  it('moves a whole block forwards, keeping the block in its own order', () => {
    expect(moveIds(ids, ['a', 'b'], 'a', 'd')).toEqual([
      'c',
      'd',
      'a',
      'b',
      'e'
    ])
  })

  it('moves a whole block backwards', () => {
    expect(moveIds(ids, ['c', 'd'], 'd', 'b')).toEqual([
      'a',
      'c',
      'd',
      'b',
      'e'
    ])
  })

  it('gathers a non-contiguous selection at the drop point', () => {
    expect(moveIds(ids, ['a', 'c'], 'a', 'd')).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e'
    ])
  })

  it('takes the block order from the list, not from the ids it is handed', () => {
    expect(moveIds(ids, ['c', 'a'], 'a', 'd')).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e'
    ])
  })

  it('changes nothing when the row is dropped on itself', () => {
    expect(moveIds(ids, ['a'], 'a', 'a')).toEqual(ids)
  })

  it('changes nothing when the drop target is inside the moving block', () => {
    expect(moveIds(ids, ['a', 'b', 'c'], 'a', 'b')).toEqual(ids)
  })

  it('changes nothing when the dragged row has left the list', () => {
    expect(moveIds(ids, ['gone'], 'gone', 'c')).toEqual(ids)
  })

  it('changes nothing when the drop target has left the list', () => {
    expect(moveIds(ids, ['a'], 'a', 'gone')).toEqual(ids)
  })

  it('ignores moving ids that are no longer in the list', () => {
    expect(moveIds(ids, ['a', 'gone'], 'a', 'c')).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e'
    ])
  })
})
