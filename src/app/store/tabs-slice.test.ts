import { describe, expect, it } from 'vitest'

import reducer, { initialTabsState, tabsActions, type TabsState } from './tabs-slice'

function stateOf(
  openWorksheetIds: string[],
  activeWorksheetId?: string
): TabsState {
  return { activeWorksheetId, openWorksheetIds }
}

describe('tabsSlice', () => {
  describe('tabOpened', () => {
    it('opens and activates a worksheet that is not open yet', () => {
      const state = reducer(initialTabsState, tabsActions.tabOpened('a'))

      expect(state).toEqual(stateOf(['a'], 'a'))
    })

    it('activates an already open worksheet without duplicating the tab', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'b'),
        tabsActions.tabOpened('a')
      )

      expect(state).toEqual(stateOf(['a', 'b'], 'a'))
    })

    it('appends new tabs to the end', () => {
      const state = reducer(stateOf(['a'], 'a'), tabsActions.tabOpened('b'))

      expect(state).toEqual(stateOf(['a', 'b'], 'b'))
    })
  })

  describe('tabActivated', () => {
    it('activates an open tab', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'a'),
        tabsActions.tabActivated('b')
      )

      expect(state).toEqual(stateOf(['a', 'b'], 'b'))
    })

    it('ignores a worksheet that is not open', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'a'),
        tabsActions.tabActivated('c')
      )

      expect(state).toEqual(stateOf(['a', 'b'], 'a'))
    })
  })

  describe('tabClosed', () => {
    it('activates the last remaining tab when the active one closes', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'b'),
        tabsActions.tabClosed('b')
      )

      expect(state).toEqual(stateOf(['a', 'c'], 'c'))
    })

    it('keeps the active tab when a background tab closes', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'c'),
        tabsActions.tabClosed('a')
      )

      expect(state).toEqual(stateOf(['b', 'c'], 'c'))
    })

    it('allows closing the final tab and leaves nothing active', () => {
      const state = reducer(stateOf(['a'], 'a'), tabsActions.tabClosed('a'))

      expect(state).toEqual(stateOf([], undefined))
    })

    it('ignores a worksheet that is not open', () => {
      const state = reducer(stateOf(['a'], 'a'), tabsActions.tabClosed('b'))

      expect(state).toEqual(stateOf(['a'], 'a'))
    })
  })

  describe('tabsReconciled', () => {
    it('drops tabs whose worksheets no longer exist', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'a'),
        tabsActions.tabsReconciled({ availableIds: ['a', 'c'] })
      )

      expect(state).toEqual(stateOf(['a', 'c'], 'a'))
    })

    it('activates the last survivor when the active worksheet is gone', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'b'),
        tabsActions.tabsReconciled({ availableIds: ['a', 'c'] })
      )

      expect(state).toEqual(stateOf(['a', 'c'], 'c'))
    })

    it('falls back to the pick when nothing survives', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'a'),
        tabsActions.tabsReconciled({ availableIds: ['z'], fallbackId: 'z' })
      )

      expect(state).toEqual(stateOf(['z'], 'z'))
    })

    it('leaves nothing open when nothing survives and there is no fallback', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'a'),
        tabsActions.tabsReconciled({ availableIds: [] })
      )

      expect(state).toEqual(stateOf([], undefined))
    })

    it('adopts an active tab when the stored one was missing', () => {
      const state = reducer(
        stateOf(['a', 'b'], undefined),
        tabsActions.tabsReconciled({ availableIds: ['a', 'b'] })
      )

      expect(state).toEqual(stateOf(['a', 'b'], 'b'))
    })
  })

  describe('tabsReordered', () => {
    it('reorders the open tabs', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'a'),
        tabsActions.tabsReordered(['c', 'a', 'b'])
      )

      expect(state).toEqual(stateOf(['c', 'a', 'b'], 'a'))
    })

    it('ignores an order that does not describe exactly the open tabs', () => {
      const state = reducer(
        stateOf(['a', 'b', 'c'], 'a'),
        tabsActions.tabsReordered(['c', 'a'])
      )

      expect(state).toEqual(stateOf(['a', 'b', 'c'], 'a'))
    })
  })
})
