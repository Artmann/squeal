import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { type ListSelection } from '../list-selection'

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

// Which worksheet is open lives in the tabs slice — `tabOpened` both opens and
// activates it. `worksheetSelection` is a different thing: the rows the sidebar
// list acts on together, which is usually the open one and only differs once
// the user command- or shift-clicks. `null` is the ordinary case of nothing
// picked out.
export interface EditorState {
  databaseSearchQuery: string
  worksheetRename: WorksheetRenameSession | null
  worksheetSearchQuery: string
  worksheetSelection: ListSelection | null
}

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetRename: null,
  worksheetSearchQuery: '',
  worksheetSelection: null
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

      // Filtered rows cannot be dragged and hidden ones cannot be seen, so a
      // selection that outlived the query would let the next delete act on
      // rows the user is no longer looking at.
      state.worksheetSelection = null
    },
    // The whole selection, computed by the surface that owns the list: the
    // range a shift-click covers depends on the order the rows are in and on
    // which one is open, neither of which is in this slice. `null` is nothing
    // picked out.
    worksheetSelectionChanged: (
      state,
      action: PayloadAction<ListSelection | null>
    ) => {
      state.worksheetSelection = action.payload
    }
  }
})

export const {
  databaseSearchQueryUpdated,
  worksheetRenameDraftUpdated,
  worksheetRenameEnded,
  worksheetRenameStarted,
  worksheetSearchQueryUpdated,
  worksheetSelectionChanged
} = editorSlice.actions

export default editorSlice.reducer
