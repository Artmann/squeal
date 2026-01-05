import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface EditorScreen {
  databaseId?: string
  type: 'edit-database' | 'create-database'
}

export interface UiState {
  editorScreen?: EditorScreen
  showGettingStartedScreen?: boolean
}

const initialState: UiState = {
  showGettingStartedScreen: true
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    closeEditorScreen: (state) => {
      state.editorScreen = undefined
    },

    gettingStartedCompleted: (state) => {
      state.showGettingStartedScreen = false
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
    }
  }
})

export const uiActions = uiSlice.actions

export default uiSlice.reducer
