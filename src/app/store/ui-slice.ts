import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface EditorScreen {
  databaseId?: string
  type: 'edit-database' | 'create-database'
}

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
