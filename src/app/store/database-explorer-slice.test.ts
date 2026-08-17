import { describe, expect, it } from 'vitest'

import reducer, {
  DatabaseExplorerState,
  expandTable,
  setDatabaseExpanded
} from './database-explorer-slice'

describe('databaseExplorerSlice', () => {
  const initialState: DatabaseExplorerState = {
    expandedDatabases: {},
    expandedTables: {}
  }

  describe('setDatabaseExpanded', () => {
    it('should record an explicit expand for a database with no entry', () => {
      const state = reducer(
        initialState,
        setDatabaseExpanded({
          databaseId: 'db-123',
          isExpanded: true,
          query: ''
        })
      )

      expect(state.expandedDatabases).toEqual({
        'db-123': { isExpanded: true, query: '' }
      })
    })

    it('should record an explicit collapse for a database with no entry', () => {
      const state = reducer(
        initialState,
        setDatabaseExpanded({
          databaseId: 'db-123',
          isExpanded: false,
          query: ''
        })
      )

      // Absent means "follow the search"; a stored collapse is the user saying
      // no, so the two must stay distinguishable.
      expect(state.expandedDatabases).toEqual({
        'db-123': { isExpanded: false, query: '' }
      })
    })

    it('should stamp the query the decision was made under', () => {
      const state = reducer(
        initialState,
        setDatabaseExpanded({
          databaseId: 'db-123',
          isExpanded: false,
          query: 'user'
        })
      )

      expect(state.expandedDatabases).toEqual({
        'db-123': { isExpanded: false, query: 'user' }
      })
    })

    it('should overwrite a stored expand with a collapse', () => {
      const expandedState: DatabaseExplorerState = {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } },
        expandedTables: {}
      }

      const state = reducer(
        expandedState,
        setDatabaseExpanded({
          databaseId: 'db-123',
          isExpanded: false,
          query: ''
        })
      )

      expect(state.expandedDatabases).toEqual({
        'db-123': { isExpanded: false, query: '' }
      })
    })

    it('should overwrite a stored collapse with an expand', () => {
      const collapsedState: DatabaseExplorerState = {
        expandedDatabases: { 'db-123': { isExpanded: false, query: 'user' } },
        expandedTables: {}
      }

      const state = reducer(
        collapsedState,
        setDatabaseExpanded({
          databaseId: 'db-123',
          isExpanded: true,
          query: 'user'
        })
      )

      expect(state.expandedDatabases).toEqual({
        'db-123': { isExpanded: true, query: 'user' }
      })
    })

    it('should handle multiple databases independently', () => {
      let state = reducer(
        initialState,
        setDatabaseExpanded({ databaseId: 'db-1', isExpanded: true, query: '' })
      )
      state = reducer(
        state,
        setDatabaseExpanded({ databaseId: 'db-2', isExpanded: true, query: '' })
      )

      expect(state.expandedDatabases).toEqual({
        'db-1': { isExpanded: true, query: '' },
        'db-2': { isExpanded: true, query: '' }
      })

      state = reducer(
        state,
        setDatabaseExpanded({
          databaseId: 'db-1',
          isExpanded: false,
          query: ''
        })
      )

      expect(state.expandedDatabases).toEqual({
        'db-1': { isExpanded: false, query: '' },
        'db-2': { isExpanded: true, query: '' }
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
