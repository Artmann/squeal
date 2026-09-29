import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector, useStore } from 'react-redux'

import databaseExplorerReducer, {
  DatabaseExplorerState
} from './database-explorer-slice'
import editorReducer, { EditorState } from './editor-slice'
import {
  readGettingStartedDismissed,
  writeGettingStartedDismissed
} from './getting-started-storage'
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebar-storage'
import tabsReducer, { TabsState } from './tabs-slice'
import { readStoredTabs, writeStoredTabs } from './tabs-storage'
import uiReducer, { UiState } from './ui-slice'

interface RootState {
  databaseExplorer: DatabaseExplorerState
  editor: EditorState
  tabs: TabsState
  ui: UiState
}

export function createStore() {
  const store = configureStore({
    preloadedState: {
      tabs: readStoredTabs(),
      ui: {
        gettingStartedDismissed: readGettingStartedDismissed(),
        sidebarCollapsed: readSidebarCollapsed()
      }
    },
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
  let persistedTabs = store.getState().tabs
  let persistedDismissal = store.getState().ui.gettingStartedDismissed
  let persistedSidebarCollapsed = store.getState().ui.sidebarCollapsed

  store.subscribe(() => {
    const { tabs, ui } = store.getState()

    if (tabs !== persistedTabs) {
      persistedTabs = tabs
      writeStoredTabs(tabs)
    }

    // Only these fields of `ui` are persisted, so they are compared by value
    // rather than by slice reference — every editor screen opening would
    // otherwise write them again.
    if (ui.gettingStartedDismissed !== persistedDismissal) {
      persistedDismissal = ui.gettingStartedDismissed
      writeGettingStartedDismissed(ui.gettingStartedDismissed ?? false)
    }

    if (ui.sidebarCollapsed !== persistedSidebarCollapsed) {
      persistedSidebarCollapsed = ui.sidebarCollapsed
      writeSidebarCollapsed(ui.sidebarCollapsed ?? false)
    }
  })

  return store
}

type AppStore = ReturnType<typeof createStore>
type AppDispatch = AppStore['dispatch']

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()

// For the rare read that must not subscribe the component: a callback that
// needs the state as it is at the moment it runs, not as it was when the
// callback was created.
export const useAppStore = useStore.withTypes<AppStore>()
