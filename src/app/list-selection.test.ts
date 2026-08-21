import { describe, expect, it } from 'vitest'

import {
  extendSelection,
  pruneSelection,
  replaceSelection,
  toggleSelection
} from './list-selection'

const ids = ['a', 'b', 'c', 'd', 'e']

describe('replaceSelection', () => {
  it('selects the one row and anchors on it', () => {
    expect(replaceSelection('c')).toEqual({ anchorId: 'c', ids: ['c'] })
  })
})

describe('toggleSelection', () => {
  it('adds a row and moves the anchor to it', () => {
    expect(toggleSelection({ anchorId: 'a', ids: ['a'] }, 'c')).toEqual({
      anchorId: 'c',
      ids: ['a', 'c']
    })
  })

  it('removes a row that was already selected', () => {
    expect(
      toggleSelection({ anchorId: 'a', ids: ['a', 'b', 'c'] }, 'b')
    ).toEqual({ anchorId: 'b', ids: ['a', 'c'] })
  })

  it('clears the selection when it removes the last row', () => {
    expect(toggleSelection({ anchorId: 'a', ids: ['a'] }, 'a')).toEqual(null)
  })

  it('starts a selection when there is none', () => {
    expect(toggleSelection(null, 'c')).toEqual({ anchorId: 'c', ids: ['c'] })
  })
})

describe('extendSelection', () => {
  it('selects the range from the anchor forwards, in list order', () => {
    expect(extendSelection({ anchorId: 'b', ids: ['b'] }, 'd', ids)).toEqual({
      anchorId: 'b',
      ids: ['b', 'c', 'd']
    })
  })

  it('selects the range from the anchor backwards, in list order', () => {
    expect(extendSelection({ anchorId: 'd', ids: ['d'] }, 'b', ids)).toEqual({
      anchorId: 'd',
      ids: ['b', 'c', 'd']
    })
  })

  it('replaces the range instead of growing it when extended twice', () => {
    const first = extendSelection({ anchorId: 'b', ids: ['b'] }, 'd', ids)
    const second = extendSelection(first, 'c', ids)

    expect(second).toEqual({ anchorId: 'b', ids: ['b', 'c'] })
  })

  it('selects the one row when there is no selection to extend', () => {
    expect(extendSelection(null, 'c', ids)).toEqual({
      anchorId: 'c',
      ids: ['c']
    })
  })

  it('re-anchors on the clicked row when the anchor has left the list', () => {
    expect(
      extendSelection({ anchorId: 'gone', ids: ['gone'] }, 'c', ids)
    ).toEqual({ anchorId: 'c', ids: ['c'] })
  })

  it('changes nothing when the clicked row has left the list', () => {
    const selection = { anchorId: 'b', ids: ['b'] }

    expect(extendSelection(selection, 'gone', ids)).toEqual(selection)
  })
})

describe('pruneSelection', () => {
  it('drops ids that have left the list', () => {
    expect(pruneSelection({ anchorId: 'a', ids: ['a', 'gone'] }, ids)).toEqual({
      anchorId: 'a',
      ids: ['a']
    })
  })

  it('clears the selection when nothing is left', () => {
    expect(pruneSelection({ anchorId: 'gone', ids: ['gone'] }, ids)).toEqual(
      null
    )
  })

  it('re-anchors on the first surviving row when the anchor has left', () => {
    expect(
      pruneSelection({ anchorId: 'gone', ids: ['b', 'gone', 'c'] }, ids)
    ).toEqual({ anchorId: 'b', ids: ['b', 'c'] })
  })

  it('leaves a selection whose rows all still exist alone', () => {
    const selection = { anchorId: 'b', ids: ['b', 'c'] }

    expect(pruneSelection(selection, ids)).toEqual(selection)
  })

  it('answers with nothing when there is no selection', () => {
    expect(pruneSelection(null, ids)).toEqual(null)
  })
})
