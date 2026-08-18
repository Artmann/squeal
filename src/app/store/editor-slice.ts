import { createSlice, PayloadAction } from '@reduxjs/toolkit'

// Which surface opened the rename input. The session is shared, so this is how
// the sidebar list and the tab strip each tell "I am the one being edited"
// apart from "someone else is being edited" — the second of which still has to
// hold the tab hotkeys off.
export type WorksheetRenameScope = 'explorer' | 'tabs'

export interface WorksheetRenameSession {
  draftName: string
  scope: WorksheetRenameScope
  worksheetId: string
}

// Which worksheet is open now lives in the tabs slice — `tabOpened` both opens
// and activates, so there is no separate "selected" concept any more.
export interface EditorState {
  databaseSearchQuery: string
  worksheetRename: WorksheetRenameSession | null
  worksheetSearchQuery: string
}

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetRename: null,
  worksheetSearchQuery: ''
}

const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    databaseSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.databaseSearchQuery = action.payload
    },
    worksheetRenameDraftUpdated: (state, action: PayloadAction<string>) => {
      // A keystroke can only come from an input that is already open, so this
      // is the narrowing TypeScript needs rather than a case that happens.
      // Dropping the draft is still the right answer if it ever does: a
      // session invented here would have no scope to belong to.
      if (state.worksheetRename === null) {
        return
      }

      state.worksheetRename.draftName = action.payload
    },
    worksheetRenameEnded: (state) => {
      state.worksheetRename = null
    },
    // Starting a rename anywhere replaces the session, so the surface that had
    // it loses its input rather than leaving two open at once.
    worksheetRenameStarted: (
      state,
      action: PayloadAction<WorksheetRenameSession>
    ) => {
      state.worksheetRename = action.payload
    },
    worksheetSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.worksheetSearchQuery = action.payload
    }
  }
})

export const {
  databaseSearchQueryUpdated,
  worksheetRenameDraftUpdated,
  worksheetRenameEnded,
  worksheetRenameStarted,
  worksheetSearchQueryUpdated
} = editorSlice.actions

export default editorSlice.reducer
