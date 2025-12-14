import { describe, expect, it } from 'vitest'

import reducer, {
  DatabaseExplorerState,
  expandDatabase,
  expandTable
} from './database-explorer-slice'

describe('databaseExplorerSlice', () => {
  const initialState: DatabaseExplorerState = {
    expandedDatabases: {},
    expandedTables: {}
  }

  describe('expandDatabase', () => {
    it('should set database as expanded when not expanded', () => {
      const state = reducer(initialState, expandDatabase('db-123'))

      expect(state.expandedDatabases).toEqual({ 'db-123': true })
    })

    it('should toggle database to collapsed when already expanded', () => {
      const expandedState: DatabaseExplorerState = {
        expandedDatabases: { 'db-123': true },
        expandedTables: {}
      }

      const state = reducer(expandedState, expandDatabase('db-123'))

      expect(state.expandedDatabases).toEqual({ 'db-123': false })
    })

    it('should handle multiple databases independently', () => {
      let state = reducer(initialState, expandDatabase('db-1'))
      state = reducer(state, expandDatabase('db-2'))

      expect(state.expandedDatabases).toEqual({
        'db-1': true,
        'db-2': true
      })

      state = reducer(state, expandDatabase('db-1'))

      expect(state.expandedDatabases).toEqual({
        'db-1': false,
        'db-2': true
      })
    })
  })

  describe('expandTable', () => {
    it('should set table as expanded when not expanded', () => {
      const state = reducer(initialState, expandTable('db-123-users'))

      expect(state.expandedTables).toEqual({ 'db-123-users': true })
    })

    it('should toggle table to collapsed when already expanded', () => {
      const expandedState: DatabaseExplorerState = {
        expandedDatabases: {},
        expandedTables: { 'db-123-users': true }
      }

      const state = reducer(expandedState, expandTable('db-123-users'))

      expect(state.expandedTables).toEqual({ 'db-123-users': false })
    })

    it('should handle multiple tables independently', () => {
      let state = reducer(initialState, expandTable('db-1-users'))
      state = reducer(state, expandTable('db-1-posts'))
      state = reducer(state, expandTable('db-2-comments'))

      expect(state.expandedTables).toEqual({
        'db-1-posts': true,
        'db-1-users': true,
        'db-2-comments': true
      })

      state = reducer(state, expandTable('db-1-users'))

      expect(state.expandedTables).toEqual({
        'db-1-posts': true,
        'db-1-users': false,
        'db-2-comments': true
      })
    })
  })

  describe('initial state', () => {
    it('should have empty expandedDatabases and expandedTables', () => {
      const state = reducer(undefined, { type: 'unknown' })

      expect(state).toEqual({
        expandedDatabases: {},
        expandedTables: {}
      })
    })
  })
})
