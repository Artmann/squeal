import { describe, expect, it } from 'vitest'

import reducer, { editorActions, EditorState } from './editor-slice'

const initialState: EditorState = {
  databaseSearchQuery: '',
  worksheetRename: null,
  worksheetSearchQuery: '',
  worksheetSelection: null
}

const selecting: EditorState = {
  ...initialState,
  worksheetSelection: { anchorId: 'ws-1', ids: ['ws-1', 'ws-2'] }
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

  describe('setDatabaseSearchQuery', () => {
    it('stores the query', () => {
      const state = reducer(
        initialState,
        editorActions.setDatabaseSearchQuery('pagila')
      )

      expect(state).toEqual({ ...initialState, databaseSearchQuery: 'pagila' })
    })
  })

  describe('setWorksheetSearchQuery', () => {
    it('stores the query', () => {
      const state = reducer(
        initialState,
        editorActions.setWorksheetSearchQuery('rev')
      )

      expect(state).toEqual({ ...initialState, worksheetSearchQuery: 'rev' })
    })
  })

  describe('startWorksheetRename', () => {
    it('opens the session on the given surface', () => {
      const state = reducer(
        initialState,
        editorActions.startWorksheetRename({
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
        editorActions.startWorksheetRename({
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

  describe('setWorksheetRenameDraft', () => {
    it('keeps the scope and the worksheet while the name changes', () => {
      const state = reducer(
        renaming,
        editorActions.setWorksheetRenameDraft('Q3 Revenue')
      )

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
      const state = reducer(
        initialState,
        editorActions.setWorksheetRenameDraft('Q3')
      )

      expect(state).toEqual(initialState)
    })
  })

  describe('endWorksheetRename', () => {
    it('closes the session', () => {
      const state = reducer(renaming, editorActions.endWorksheetRename())

      expect(state).toEqual(initialState)
    })

    it('leaves the searches alone', () => {
      const state = reducer(
        {
          databaseSearchQuery: 'pagila',
          worksheetRename: renaming.worksheetRename,
          worksheetSearchQuery: 'rev',
          worksheetSelection: null
        },
        editorActions.endWorksheetRename()
      )

      expect(state).toEqual({
        databaseSearchQuery: 'pagila',
        worksheetRename: null,
        worksheetSearchQuery: 'rev',
        worksheetSelection: null
      })
    })
  })

  describe('setWorksheetSelection', () => {
    it('stores the rows the list acts on together', () => {
      const state = reducer(
        initialState,
        editorActions.setWorksheetSelection({
          anchorId: 'ws-1',
          ids: ['ws-1', 'ws-2']
        })
      )

      expect(state).toEqual(selecting)
    })

    // The selection is computed by the surface that owns the list, so its
    // "nothing is picked out" travels through the same action rather than a
    // second one that would have to be kept in step with it.
    it('clears the selection when handed nothing', () => {
      const state = reducer(
        selecting,
        editorActions.setWorksheetSelection(null)
      )

      expect(state).toEqual(initialState)
    })
  })

  describe('filtering', () => {
    // A filtered list cannot be dragged and its hidden rows cannot be seen, so
    // a selection surviving the change would act on rows the user is no longer
    // looking at.
    it('clears the selection when the worksheet filter changes', () => {
      const state = reducer(
        selecting,
        editorActions.setWorksheetSearchQuery('rev')
      )

      expect(state).toEqual({ ...initialState, worksheetSearchQuery: 'rev' })
    })
  })
})
