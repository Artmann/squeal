import { createSlice, PayloadAction } from '@reduxjs/toolkit'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import { QueryDto } from '@/main/queries'
import { WorksheetDto } from '@/glue/worksheets'

export interface EditorState {
  databases: DatabaseDto[]
  databaseSearchQuery: string
  openWorksheetId?: string
  queries: QueryDto[]
  schemas: Record<string, SchemaInfo>
  worksheets: WorksheetDto[]
  worksheetSearchQuery: string
}

const initialState: EditorState = {
  databases: [],
  databaseSearchQuery: '',
  queries: [],
  schemas: {},
  worksheets: [],
  worksheetSearchQuery: ''
}

export const editorSlice = createSlice({
  name: 'editor',
  initialState,
  reducers: {
    databaseAdded: (state, action: PayloadAction<DatabaseDto>) => {
      state.databases.push(action.payload)
    },
    databaseSearchQueryUpdated: (state, action: PayloadAction<string>) => {
      state.databaseSearchQuery = action.payload
    },
    databaseUpdated: (state, action: PayloadAction<DatabaseDto>) => {
      const index = state.databases.findIndex(
        (database) => database.id === action.payload.id
      )

      if (index >= 0) {
        state.databases[index] = action.payload
      }
    },
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
    },
    worksheetContentUpdated: (
      state,
      action: PayloadAction<{ id: string; content: string }>
    ) => {
      const index = state.worksheets.findIndex(
        (worksheet) => worksheet.id === action.payload.id
      )

      if (index >= 0) {
        state.worksheets[index].content = action.payload.content
      }
    },
    worksheetCreated: (state, action: PayloadAction<WorksheetDto>) => {
      state.worksheets.push(action.payload)
      state.openWorksheetId = action.payload.id
    },
    worksheetRemoved: (state, action: PayloadAction<string>) => {
      state.worksheets = state.worksheets.filter(
        (worksheet) => worksheet.id !== action.payload
      )

      if (state.openWorksheetId === action.payload) {
        state.openWorksheetId = state.worksheets[0]?.id
      }
    },
    worksheetUpdated: (state, action: PayloadAction<WorksheetDto>) => {
      const index = state.worksheets.findIndex(
        (worksheet) => worksheet.id === action.payload.id
      )

      if (index >= 0) {
        state.worksheets[index] = action.payload
      }
    },
    schemaFetched: (
      state,
      action: PayloadAction<{ databaseId: string; schema: SchemaInfo }>
    ) => {
      state.schemas[action.payload.databaseId] = action.payload.schema
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
  databaseAdded,
  databaseSearchQueryUpdated,
  databaseUpdated,
  queriesFetched,
  queryCreated,
  queryFetched,
  schemaFetched,
  worksheetCreated,
  worksheetRemoved,
  worksheetSearchQueryUpdated,
  worksheetSelected,
  worksheetUpdated
} = editorSlice.actions

export default editorSlice.reducer
