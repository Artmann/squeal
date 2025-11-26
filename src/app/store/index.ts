import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

import editorReducer, { EditorState } from './editorSlice'

export interface RootState {
  editor: EditorState
}

export function createStore() {
  const worksheets = window.__BOOTSTRAP_DATA__.worksheets
  const store = configureStore({
    reducer: {
      editor: editorReducer
    },
    preloadedState: {
      editor: {
        openWorksheetId: worksheets[0]?.id ?? undefined,
        queries: [],
        worksheets
      }
    }
  })

  return store
}

export type AppDispatch = ReturnType<typeof createStore>['dispatch']

export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
