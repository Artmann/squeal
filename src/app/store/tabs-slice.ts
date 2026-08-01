import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface TabsState {
  activeWorksheetId?: string
  openWorksheetIds: string[]
}

export interface TabsReconciliation {
  /** Every worksheet id that still exists. */
  availableIds: string[]
  /** Opened when nothing survives reconciliation. */
  fallbackId?: string
}

export const initialTabsState: TabsState = {
  openWorksheetIds: []
}

// Closing the active tab lands on the last remaining one, matching the design's
// `closeTab`. Returns undefined once nothing is left, which is a legal state —
// the editor area shows the "no worksheet" prompt.
function lastTab(openWorksheetIds: string[]): string | undefined {
  return openWorksheetIds[openWorksheetIds.length - 1]
}

export const tabsSlice = createSlice({
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

      const surviving = state.openWorksheetIds.filter((id) =>
        availableIds.includes(id)
      )

      const openWorksheetIds =
        surviving.length === 0 && fallbackId !== undefined
          ? [fallbackId]
          : surviving

      const activeWorksheetId =
        state.activeWorksheetId !== undefined &&
        openWorksheetIds.includes(state.activeWorksheetId)
          ? state.activeWorksheetId
          : lastTab(openWorksheetIds)

      // This runs on every worksheets update, so it only writes when something
      // actually changed. Assigning unconditionally would hand the persistence
      // subscriber a new object each time and write to localStorage on every
      // render.
      if (
        activeWorksheetId === state.activeWorksheetId &&
        openWorksheetIds.length === state.openWorksheetIds.length &&
        openWorksheetIds.every((id, index) => id === state.openWorksheetIds[index])
      ) {
        return
      }

      state.activeWorksheetId = activeWorksheetId
      state.openWorksheetIds = openWorksheetIds
    },

    tabsReordered: (state, action: PayloadAction<string[]>) => {
      const reordered = action.payload.filter((id) =>
        state.openWorksheetIds.includes(id)
      )

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
