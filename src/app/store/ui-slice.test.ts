import { describe, expect, it } from 'vitest'

import reducer, { uiActions, UiState } from './ui-slice'

describe('uiSlice', () => {
  const initialState: UiState = {}

  describe('initial state', () => {
    it('should have no editor screen', () => {
      const state = reducer(undefined, { type: 'unknown' })

      expect(state).toEqual({})
    })
  })

  describe('openCreateDatabase', () => {
    it('should set editorScreen with type create-database', () => {
      const state = reducer(initialState, uiActions.openCreateDatabase())

      expect(state.editorScreen).toEqual({
        type: 'create-database'
      })
    })

    it('should not include databaseId when creating', () => {
      const state = reducer(initialState, uiActions.openCreateDatabase())

      expect(state.editorScreen?.databaseId).toBeUndefined()
    })
  })

  describe('openEditDatabase', () => {
    it('should set editorScreen with type edit-database and databaseId', () => {
      const state = reducer(initialState, uiActions.openEditDatabase('db-123'))

      expect(state.editorScreen).toEqual({
        databaseId: 'db-123',
        type: 'edit-database'
      })
    })
  })

  describe('closeEditorScreen', () => {
    it('should clear editorScreen', () => {
      const stateWithScreen: UiState = {
        editorScreen: { type: 'create-database' }
      }

      const state = reducer(stateWithScreen, uiActions.closeEditorScreen())

      expect(state.editorScreen).toBeUndefined()
    })
  })
})
