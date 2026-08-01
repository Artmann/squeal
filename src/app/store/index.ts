import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import databaseExplorerReducer, {
  DatabaseExplorerState
} from './database-explorer-slice'
import editorReducer, { EditorState } from './editor-slice'
import tabsReducer, { TabsState } from './tabs-slice'
import { readStoredTabs, writeStoredTabs } from './tabs-storage'
import uiReducer, { UiState } from './ui-slice'

export interface RootState {
  databaseExplorer: DatabaseExplorerState
  editor: EditorState
  tabs: TabsState
  ui: UiState
}

export function createStore() {
  const store = configureStore({
    preloadedState: { tabs: readStoredTabs() },
    reducer: {
      databaseExplorer: databaseExplorerReducer,
      editor: editorReducer,
      tabs: tabsReducer,
      ui: uiReducer
    }
  })

  // Persisting from a subscriber rather than inside the reducers keeps the
  // reducers pure and unit-testable. Comparing the slice reference stops every
  // unrelated dispatch from writing to localStorage.
  let persisted = store.getState().tabs

  store.subscribe(() => {
    const { tabs } = store.getState()

    if (tabs === persisted) {
      return
    }

    persisted = tabs
    writeStoredTabs(tabs)
  })

  return store
}

type AppDispatch = ReturnType<typeof createStore>['dispatch']

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
