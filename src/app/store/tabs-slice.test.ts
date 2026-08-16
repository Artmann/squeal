import { describe, expect, it } from 'vitest'

import reducer, {
  initialTabsState,
  tabsActions,
  type TabsState
} from './tabs-slice'

// Defaults to the steady state the app spends its life in: the tabs have
// already met the worksheet list. The bootstrap cases pass 'restored'.
function stateOf(
  openWorksheetIds: string[],
  activeWorksheetId?: string,
  status: TabsState['status'] = 'reconciled'
): TabsState {
  return { activeWorksheetId, openWorksheetIds, status }
}

describe('tabsSlice', () => {
  describe('tabOpened', () => {
    it('opens and activates a worksheet that is not open yet', () => {
      const state = reducer(initialTabsState, tabsActions.tabOpened('a'))

      expect(state).toEqual(stateOf(['a'], 'a', 'restored'))
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

    // Restored rather than reconciled: an empty worksheet list says nothing
    // about what the user wants open, so the strip has to stay bootstrappable.
    it('leaves nothing open when nothing survives and there is no fallback', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'a'),
        tabsActions.tabsReconciled({ availableIds: [] })
      )

      expect(state).toEqual(stateOf([], undefined, 'restored'))
    })

    it('adopts an active tab when the stored one was missing', () => {
      const state = reducer(
        stateOf(['a', 'b'], undefined),
        tabsActions.tabsReconciled({ availableIds: ['a', 'b'] })
      )

      expect(state).toEqual(stateOf(['a', 'b'], 'b'))
    })

    // The user closed their last tab. Reconciliation runs again on that very
    // write, and reopening the worksheet here is what made the "no worksheet
    // open" state unreachable.
    it('leaves the tabs closed once they have been reconciled', () => {
      const state = reducer(
        stateOf([], undefined),
        tabsActions.tabsReconciled({ availableIds: ['a'], fallbackId: 'a' })
      )

      expect(state).toEqual(stateOf([], undefined))
    })

    // Booting with stored tabs whose active one is gone. The survivors are
    // still the user's tabs, so the pick must not stand in for them — only an
    // empty strip is short of something to show.
    it('keeps the surviving restored tabs rather than the fallback', () => {
      const state = reducer(
        stateOf(['a', 'b'], 'b', 'restored'),
        tabsActions.tabsReconciled({
          availableIds: ['a', 'c'],
          fallbackId: 'c'
        })
      )

      expect(state).toEqual(stateOf(['a'], 'a'))
    })

    // Startup: nothing was stored, so a worksheet still has to be picked.
    it('opens the fallback while the tabs are still only restored', () => {
      const state = reducer(
        stateOf([], undefined, 'restored'),
        tabsActions.tabsReconciled({ availableIds: ['a'], fallbackId: 'a' })
      )

      expect(state).toEqual(stateOf(['a'], 'a'))
    })

    // Deleting a worksheet does no tab bookkeeping of its own — it relies on
    // this fallback to open the next one.
    it('opens the fallback when the prune itself took the last tab', () => {
      const state = reducer(
        stateOf(['a'], 'a'),
        tabsActions.tabsReconciled({ availableIds: ['b'], fallbackId: 'b' })
      )

      expect(state).toEqual(stateOf(['b'], 'b'))
    })

    // The no-op guard has to notice the status alone changing. Leaving the
    // state on 'restored' would let the next close bootstrap all over again.
    it('records the reconciliation even when the tabs did not change', () => {
      const state = reducer(
        stateOf(['a'], 'a', 'restored'),
        tabsActions.tabsReconciled({ availableIds: ['a'] })
      )

      expect(state).toEqual(stateOf(['a'], 'a'))
    })

    // The worksheet list going empty and coming back — a refetch, or another
    // window deleting and recreating. Nothing here is the user closing a tab,
    // so recording it as reconciled would strand the strip empty for good.
    it('opens a worksheet again after the list emptied and refilled', () => {
      const emptied = reducer(
        stateOf(['a'], 'a'),
        tabsActions.tabsReconciled({ availableIds: [] })
      )

      // The effect fires once more on the write above, still with nothing to
      // offer. This is the pass that used to overwrite the status.
      const settled = reducer(
        emptied,
        tabsActions.tabsReconciled({ availableIds: [] })
      )

      const refilled = reducer(
        settled,
        tabsActions.tabsReconciled({ availableIds: ['a'], fallbackId: 'a' })
      )

      expect(refilled).toEqual(stateOf(['a'], 'a'))
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
