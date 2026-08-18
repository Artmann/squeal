import { describe, expect, it } from 'vitest'

import reducer, {
  databaseSearchQueryUpdated,
  EditorState,
  worksheetRenameDraftUpdated,
  worksheetRenameEnded,
  worksheetRenameStarted,
  worksheetSearchQueryUpdated
} from './editor-slice'

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetRename: null,
  worksheetSearchQuery: ''
}

const renaming: EditorState = {
  ...initialState,
  worksheetRename: {
    draftName: 'Revenue',
    scope: 'explorer',
    worksheetId: 'ws-1'
  }
}

describe('editorSlice', () => {
  describe('initial state', () => {
    it('starts with no rename and no searches', () => {
      const state = reducer(undefined, { type: 'unknown' })

      expect(state).toEqual(initialState)
    })
  })

  describe('databaseSearchQueryUpdated', () => {
    it('stores the query', () => {
      const state = reducer(initialState, databaseSearchQueryUpdated('pagila'))

      expect(state).toEqual({ ...initialState, databaseSearchQuery: 'pagila' })
    })
  })

  describe('worksheetSearchQueryUpdated', () => {
    it('stores the query', () => {
      const state = reducer(initialState, worksheetSearchQueryUpdated('rev'))

      expect(state).toEqual({ ...initialState, worksheetSearchQuery: 'rev' })
    })
  })

  describe('worksheetRenameStarted', () => {
    it('opens the session on the given surface', () => {
      const state = reducer(
        initialState,
        worksheetRenameStarted({
          draftName: 'Revenue',
          scope: 'explorer',
          worksheetId: 'ws-1'
        })
      )

      expect(state).toEqual(renaming)
    })

    // There is one session for the whole app, so the surface that had it loses
    // its input rather than leaving two open at once.
    it('replaces a session the other surface had open', () => {
      const state = reducer(
        renaming,
        worksheetRenameStarted({
          draftName: 'Signups',
          scope: 'tabs',
          worksheetId: 'ws-2'
        })
      )

      expect(state).toEqual({
        ...initialState,
        worksheetRename: {
          draftName: 'Signups',
          scope: 'tabs',
          worksheetId: 'ws-2'
        }
      })
    })
  })

  describe('worksheetRenameDraftUpdated', () => {
    it('keeps the scope and the worksheet while the name changes', () => {
      const state = reducer(renaming, worksheetRenameDraftUpdated('Q3 Revenue'))

      expect(state).toEqual({
        ...initialState,
        worksheetRename: {
          draftName: 'Q3 Revenue',
          scope: 'explorer',
          worksheetId: 'ws-1'
        }
      })
    })

    it('invents no session when none is open', () => {
      const state = reducer(initialState, worksheetRenameDraftUpdated('Q3'))

      expect(state).toEqual(initialState)
    })
  })

  describe('worksheetRenameEnded', () => {
    it('closes the session', () => {
      const state = reducer(renaming, worksheetRenameEnded())

      expect(state).toEqual(initialState)
    })

    it('leaves the searches alone', () => {
      const state = reducer(
        {
          databaseSearchQuery: 'pagila',
          worksheetRename: renaming.worksheetRename,
          worksheetSearchQuery: 'rev'
        },
        worksheetRenameEnded()
      )

      expect(state).toEqual({
        databaseSearchQuery: 'pagila',
        worksheetRename: null,
        worksheetSearchQuery: 'rev'
      })
    })
  })
})
