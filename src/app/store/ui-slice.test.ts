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

  describe('toggleTraceDashboard', () => {
    it('opens the dashboard from the initial state', () => {
      const state = reducer(initialState, uiActions.toggleTraceDashboard())

      expect(state.traceDashboardOpen).toEqual(true)
    })

    it('closes an open dashboard', () => {
      const openState: UiState = { traceDashboardOpen: true }

      const state = reducer(openState, uiActions.toggleTraceDashboard())

      expect(state.traceDashboardOpen).toEqual(false)
    })
  })

  describe('closeTraceDashboard', () => {
    it('closes the dashboard', () => {
      const openState: UiState = { traceDashboardOpen: true }

      const state = reducer(openState, uiActions.closeTraceDashboard())

      expect(state.traceDashboardOpen).toEqual(false)
    })
  })
})
