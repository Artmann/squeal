import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export interface DatabaseExplorerState {
  expandedDatabases: Record<string, boolean>
  expandedTables: Record<string, boolean>
}

const initialState: DatabaseExplorerState = {
  expandedDatabases: {},
  expandedTables: {}
}

export const databaseExplorerSlice = createSlice({
  name: 'databaseExplorer',
  initialState,
  reducers: {
    expandDatabase: (state, action: PayloadAction<string>) => {
      const databaseId = action.payload

      state.expandedDatabases[databaseId] = !state.expandedDatabases[databaseId]
    },
    expandTable: (state, action: PayloadAction<string>) => {
      const tableKey = action.payload

      state.expandedTables[tableKey] = !state.expandedTables[tableKey]
    }
  }
})

export const { expandDatabase, expandTable } = databaseExplorerSlice.actions

export default databaseExplorerSlice.reducer
