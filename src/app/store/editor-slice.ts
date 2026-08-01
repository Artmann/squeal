import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// Which worksheet is open now lives in the tabs slice — `tabOpened` both opens
// and activates, so there is no separate "selected" concept any more.
export interface EditorState {
  databaseSearchQuery: string
  worksheetSearchQuery: string
}

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetSearchQuery: ''
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    databaseSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.databaseSearchQuery = action.payload
    },
    worksheetSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.worksheetSearchQuery = action.payload
    }
  }
})

export const { databaseSearchQueryUpdated, worksheetSearchQueryUpdated } =
  editorSlice.actions

export default editorSlice.reducer
