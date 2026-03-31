import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import databaseExplorerReducer, {
  DatabaseExplorerState
} from './database-explorer-slice'
import editorReducer, { EditorState } from './editor-slice'
import uiReducer, { UiState } from './ui-slice'

export interface RootState {
  databaseExplorer: DatabaseExplorerState
  editor: EditorState
  ui: UiState
}

export function createStore() {
  const { databases, lastOpenWorksheetId, worksheets } =
    window.__BOOTSTRAP_DATA__

  const openWorksheetId = lastOpenWorksheetId ?? worksheets[0]?.id

  const store = configureStore({
    reducer: {
      databaseExplorer: databaseExplorerReducer,
      editor: editorReducer,
      ui: uiReducer
    },
    preloadedState: {
      editor: {
        databases,
        databaseSearchQuery: '',
        openWorksheetId,
        queries: [],
        schemas: {},
        worksheets,
        worksheetSearchQuery: ''
      },
      ui: {
        showGettingStartedScreen: databases.length === 0
      }
    }
  })

  return store
}

export type AppDispatch = ReturnType<typeof createStore>['dispatch']

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
