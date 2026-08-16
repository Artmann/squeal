import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface TabsState {
  activeWorksheetId?: string
  openWorksheetIds: string[]
  /**
   * Whether an empty tab strip is a decision or merely a starting point.
   * `reconciled` means these tabs have met the worksheet list, so no tabs is
   * the user's own doing and has to be left alone. `restored` means they have
   * not, so a worksheet still has to be picked for them.
   */
  status: 'reconciled' | 'restored'
}

interface TabsReconciliation {
  /** Every worksheet id that still exists. */
  availableIds: string[]
  /** Opened when nothing survives reconciliation. */
  fallbackId?: string
}

// Restored rather than reconciled: nothing here has met the worksheet list yet,
// so the first reconcile is free to pick a worksheet. That also makes it the
// right answer for `readStoredTabs` when there is nothing to restore, and keeps
// a store built without preloaded tabs from being one that never bootstraps.
export const initialTabsState: TabsState = {
  openWorksheetIds: [],
  status: 'restored'
}

/**
 * Whether reconciliation decided anything the state does not already say. It
 * runs on every worksheets update, so the reducer only writes when it did:
 * assigning unconditionally would hand the persistence subscriber a new object
 * each time and write to localStorage on every render. The status counts as a
 * change of its own — a first reconcile that found the tabs already right still
 * has to record itself, or the next close would bootstrap a worksheet all over
 * again.
 */
function isUnchanged(state: TabsState, next: TabsState): boolean {
  return (
    next.status === state.status &&
    next.activeWorksheetId === state.activeWorksheetId &&
    next.openWorksheetIds.length === state.openWorksheetIds.length &&
    next.openWorksheetIds.every(
      (id, index) => id === state.openWorksheetIds[index]
    )
  )
}

// Closing the active tab lands on the last remaining one, matching the design's
// `closeTab`. Returns undefined once nothing is left, which is a legal state —
// the editor area shows the "no worksheet" prompt.
function lastTab(openWorksheetIds: string[]): string | undefined {
  return openWorksheetIds[openWorksheetIds.length - 1]
}

/** Keeps the active tab while it is still open, otherwise lands on the last. */
function pickActiveTab(
  openWorksheetIds: string[],
  activeWorksheetId: string | undefined
): string | undefined {
  if (
    activeWorksheetId !== undefined &&
    openWorksheetIds.includes(activeWorksheetId)
  ) {
    return activeWorksheetId
  }

  return lastTab(openWorksheetIds)
}

/**
 * The tabs that should be open: the ones whose worksheet still exists, or the
 * fallback pick when nothing is left and something ought to be.
 *
 * No open tabs means one of three things, and only two of them want a worksheet
 * opened: tabs restored from storage that have not met the worksheet list yet,
 * and a prune that just took the last one — deleting a worksheet does no tab
 * bookkeeping of its own and relies on this. The third is the user closing
 * their last tab, which has to stay closed.
 */
function resolveOpenTabs(
  state: TabsState,
  availableIds: string[],
  fallbackId: string | undefined
): string[] {
  // A Set rather than repeated `includes`: this runs on every worksheets
  // update, and the id list grows with the user's worksheets.
  const available = new Set(availableIds)

  const surviving = state.openWorksheetIds.filter((id) => available.has(id))

  if (surviving.length > 0 || fallbackId === undefined) {
    return surviving
  }

  // Nothing survived. Whether this reconcile is what emptied the strip is the
  // difference between a worksheet being deleted and a user closing their tabs.
  const pruned = surviving.length !== state.openWorksheetIds.length

  return state.status === 'restored' || pruned ? [fallbackId] : surviving
}

/**
 * Ending up with nothing to show and nothing to offer instead means the
 * worksheet list itself is empty, so this reconcile learned nothing about what
 * the user wants open. Holding the status at `restored` there is what lets the
 * strip bootstrap again once a worksheet reappears; recording it as reconciled
 * would strand the user on an empty editor for good.
 */
function resolveStatus(
  openWorksheetIds: string[],
  fallbackId: string | undefined
): TabsState['status'] {
  if (openWorksheetIds.length === 0 && fallbackId === undefined) {
    return 'restored'
  }

  return 'reconciled'
}

const tabsSlice = createSlice({
  name: 'tabs',
  initialState: initialTabsState,
  reducers: {
    tabActivated: (state, action: PayloadAction<string>) => {
      if (!state.openWorksheetIds.includes(action.payload)) {
        return
      }

      state.activeWorksheetId = action.payload
    },

    tabClosed: (state, action: PayloadAction<string>) => {
      const wasActive = state.activeWorksheetId === action.payload

      state.openWorksheetIds = state.openWorksheetIds.filter(
        (id) => id !== action.payload
      )

      // Closing a background tab must not steal focus from the active one.
      if (wasActive) {
        state.activeWorksheetId = lastTab(state.openWorksheetIds)
      }
    },

    tabOpened: (state, action: PayloadAction<string>) => {
      if (!state.openWorksheetIds.includes(action.payload)) {
        state.openWorksheetIds.push(action.payload)
      }

      state.activeWorksheetId = action.payload
    },

    /**
     * Drops tabs for worksheets that no longer exist — deleted here or in
     * another window — and falls back to a pick when nothing survives.
     */
    tabsReconciled: (state, action: PayloadAction<TabsReconciliation>) => {
      const { availableIds, fallbackId } = action.payload

      const openWorksheetIds = resolveOpenTabs(state, availableIds, fallbackId)

      const next: TabsState = {
        activeWorksheetId: pickActiveTab(
          openWorksheetIds,
          state.activeWorksheetId
        ),
        openWorksheetIds,
        status: resolveStatus(openWorksheetIds, fallbackId)
      }

      if (isUnchanged(state, next)) {
        return
      }

      state.activeWorksheetId = next.activeWorksheetId
      state.openWorksheetIds = next.openWorksheetIds
      state.status = next.status
    },

    tabsReordered: (state, action: PayloadAction<string[]>) => {
      const open = new Set(state.openWorksheetIds)

      const reordered = action.payload.filter((id) => open.has(id))

      // Ignore a reorder that does not describe exactly the open tabs rather
      // than silently dropping or duplicating one.
      if (reordered.length !== state.openWorksheetIds.length) {
        return
      }

      state.openWorksheetIds = reordered
    }
  }
})

export const tabsActions = tabsSlice.actions

export function selectActiveWorksheetId(state: {
  tabs: TabsState
}): string | undefined {
  return state.tabs.activeWorksheetId
}

export function selectOpenWorksheetIds(state: { tabs: TabsState }): string[] {
  return state.tabs.openWorksheetIds
}

export default tabsSlice.reducer
