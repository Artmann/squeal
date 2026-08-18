import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// A discriminated union rather than an optional id beside a free type: the
// reducers below only ever produce these two pairings, and saying so is what
// lets the screen be handed the state as its props with no translation and no
// branch for a combination that cannot occur.
export type EditorScreen =
  | { type: 'create-database' }
  | { databaseId: string; type: 'edit-database' }

export interface UiState {
  editorScreen?: EditorScreen
  gettingStartedDismissed?: boolean
  traceDashboardOpen?: boolean
}

const initialState: UiState = {}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    closeEditorScreen: (state) => {
      state.editorScreen = undefined
    },

    closeTraceDashboard: (state) => {
      state.traceDashboardOpen = false
    },

    // Only meaningful while there are no databases: adding one hides the screen
    // on its own, and the flag stops mattering.
    dismissGettingStarted: (state) => {
      state.gettingStartedDismissed = true
    },

    openCreateDatabase: (state) => {
      state.editorScreen = {
        type: 'create-database'
      }
    },

    openEditDatabase: (state, action: PayloadAction<string>) => {
      state.editorScreen = {
        databaseId: action.payload,
        type: 'edit-database'
      }
    },

    toggleTraceDashboard: (state) => {
      state.traceDashboardOpen = !state.traceDashboardOpen
    }
  }
})

export const uiActions = uiSlice.actions

export default uiSlice.reducer
