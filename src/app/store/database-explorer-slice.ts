import { createSlice, PayloadAction } from '@reduxjs/toolkit'

/** One database's expansion, plus the context the user decided it in. */
export interface DatabaseExpansion {
  isExpanded: boolean
  /**
   * The normalized search query that was active when the user clicked, or `''`
   * when they were browsing the unfiltered tree. A decision only speaks for
   * the question it answered: while a different query is active, the search's
   * own proposal wins instead. Stamping the query rather than clearing stale
   * entries on every keystroke keeps this slice independent of the editor
   * slice, and means a decision survives round-tripping back to its query.
   */
  query: string
}

export interface DatabaseExplorerState {
  // Absent means the user has never decided for this database, so the search
  // decides. A stored entry is their own decision, scoped to `query`. A future
  // "collapse all" therefore has to write an entry per database rather than
  // delete the keys — deleting them would hand every row back to the search.
  expandedDatabases: Record<string, DatabaseExpansion | undefined>
  expandedTables: Record<string, boolean>
}

const initialState: DatabaseExplorerState = {
  expandedDatabases: {},
  expandedTables: {}
}

const databaseExplorerSlice = createSlice({
  name: 'databaseExplorer',
  initialState,
  reducers: {
    // Deliberately a plain toggle, unlike `setDatabaseExpanded` below: nothing
    // ever forces a table open, because matching is on database and table
    // names only and never column names (see `computeDatabaseMatch`), so a
    // table row's rendered state is always the stored one and flipping it is
    // safe. If matching ever reaches columns, search would want to force
    // tables open too and this toggle would reproduce the swallowed click of
    // #61 one level down — it would then need the same query-scoped treatment.
    expandTable: (state, action: PayloadAction<string>) => {
      const tableKey = action.payload

      state.expandedTables[tableKey] = !state.expandedTables[tableKey]
    },
    // Writes the value the caller means rather than flipping the stored one.
    // While a search forces a row open, the stored value and what the user
    // sees can differ, so a blind flip would move a bit nobody is looking at.
    setDatabaseExpanded: (
      state,
      action: PayloadAction<{
        databaseId: string
        isExpanded: boolean
        query: string
      }>
    ) => {
      const { databaseId, isExpanded, query } = action.payload

      state.expandedDatabases[databaseId] = { isExpanded, query }
    }
  }
})

export const { expandTable, setDatabaseExpanded } =
  databaseExplorerSlice.actions

export default databaseExplorerSlice.reducer
