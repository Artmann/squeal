import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface EditorState {
  databaseSearchQuery: string
  openWorksheetId?: string
  worksheetSearchQuery: string
}

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetSearchQuery: ''
}

export const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    databaseSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.databaseSearchQuery = action.payload
    },
    worksheetSelected: (state, action: PayloadAction<string>) => {
      state.openWorksheetId = action.payload
    },
    worksheetSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.worksheetSearchQuery = action.payload
    }
  }
})

export const {
  databaseSearchQueryUpdated,
  worksheetSearchQueryUpdated,
  worksheetSelected
} = editorSlice.actions

export default editorSlice.reducer
