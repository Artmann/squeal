import { describe, expect, it } from 'vitest'

import reducer, { uiActions, UiState } from './ui-slice'

describe('uiSlice', () => {
  const initialState: UiState = {
    showGettingStartedScreen: true
  }

  describe('initial state', () => {
    it('should have showGettingStartedScreen set to true', () => {
      const state = reducer(undefined, { type: 'unknown' })

      expect(state).toEqual({
        showGettingStartedScreen: true
      })
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

    it('should store the provided databaseId', () => {
      const state = reducer(
        initialState,
        uiActions.openEditDatabase('my-database-id')
      )

      expect(state.editorScreen?.databaseId).toEqual('my-database-id')
    })
  })

  describe('closeEditorScreen', () => {
    it('should clear editorScreen when in create mode', () => {
      const stateWithCreateScreen: UiState = {
        editorScreen: { type: 'create-database' },
        showGettingStartedScreen: false
      }

      const state = reducer(
        stateWithCreateScreen,
        uiActions.closeEditorScreen()
      )

      expect(state.editorScreen).toBeUndefined()
    })

    it('should clear editorScreen when in edit mode', () => {
      const stateWithEditScreen: UiState = {
        editorScreen: { databaseId: 'db-123', type: 'edit-database' },
        showGettingStartedScreen: false
      }

      const state = reducer(stateWithEditScreen, uiActions.closeEditorScreen())

      expect(state.editorScreen).toBeUndefined()
    })

    it('should not affect other state properties', () => {
      const stateWithScreen: UiState = {
        editorScreen: { type: 'create-database' },
        showGettingStartedScreen: false
      }

      const state = reducer(stateWithScreen, uiActions.closeEditorScreen())

      expect(state.showGettingStartedScreen).toEqual(false)
    })
  })

  describe('gettingStartedCompleted', () => {
    it('should set showGettingStartedScreen to false', () => {
      const state = reducer(initialState, uiActions.gettingStartedCompleted())

      expect(state.showGettingStartedScreen).toEqual(false)
    })

    it('should not affect editorScreen', () => {
      const stateWithScreen: UiState = {
        editorScreen: { type: 'create-database' },
        showGettingStartedScreen: true
      }

      const state = reducer(
        stateWithScreen,
        uiActions.gettingStartedCompleted()
      )

      expect(state.editorScreen).toEqual({ type: 'create-database' })
    })
  })
})
