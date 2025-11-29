import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import editorReducer, { EditorState } from './editor-slice'
import uiReducer, { UiState } from './ui-slice'
export interface RootState {
  editor: EditorState
  ui: UiState
}

export function createStore() {
  const { databases, worksheets } = window.__BOOTSTRAP_DATA__

  const store = configureStore({
    reducer: {
      editor: editorReducer,
      ui: uiReducer
    },
    preloadedState: {
      editor: {
        databases,
        openWorksheetId: worksheets[0]?.id ?? undefined,
        queries: [],
        worksheets
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
