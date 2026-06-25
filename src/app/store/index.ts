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
  return configureStore({
    reducer: {
      databaseExplorer: databaseExplorerReducer,
      editor: editorReducer,
      ui: uiReducer
    }
  })
}

export type AppDispatch = ReturnType<typeof createStore>['dispatch']

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
