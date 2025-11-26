import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { QueryDto } from '@/main/queries'
import { WorksheetDto } from '@/glue/worksheets'

interface EditorState {
  openWorksheetId?: string
  queries: QueryDto[]
  worksheets: WorksheetDto[]
}

const initialState: EditorState = {
  queries: [],
  worksheets: []
}

export const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    queriesFetched: (state, action: PayloadAction<QueryDto[]>) => {
      state.queries = action.payload
    },
    queryCreated: (state, action: PayloadAction<QueryDto>) => {
      state.queries.push(action.payload)
    },
    queryFetched: (state, action: PayloadAction<QueryDto>) => {
      const index = state.queries.findIndex(
        (query) => query.id === action.payload.id
      )

      if (index >= 0) {
        state.queries[index] = action.payload
      } else {
        state.queries.push(action.payload)
      }
    }
  }
})

export const { queriesFetched, queryCreated, queryFetched } =
  editorSlice.actions

export default editorSlice.reducer
