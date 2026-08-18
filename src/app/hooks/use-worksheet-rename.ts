import React, { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { useAppDispatch, useAppSelector, useAppStore } from '../store'
import {
  worksheetRenameDraftUpdated,
  worksheetRenameEnded,
  worksheetRenameStarted,
  type WorksheetRenameScope
} from '../store/editor-slice'
import { WorksheetDto } from '@/glue/worksheets'

export type WorksheetRenameControls = ReturnType<typeof useWorksheetRename>

/**
 * Inline renaming, shared by the sidebar list and the tab strip: which
 * worksheet is being edited, the draft name, and the commit that writes it
 * through the collection. The update is optimistic, so a rejected save rolls
 * back on its own and only needs a toast.
 *
 * There is one session for the whole app rather than one per surface, because
 * both surfaces are mounted at once and the tab hotkeys are registered with
 * `enableOnFormTags`. Held per surface, the tab strip could only see renames it
 * had started itself, so while the sidebar had a name half-typed `mod+w` closed
 * the active tab and `mod+1…9` switched to another — acting on a surface the
 * user was not looking at, under keys they had aimed at the input. `scope` is
 * what keeps the input itself in one place: `editingWorksheetId` answers "am I
 * the surface editing it", `isRenaming` answers "is anyone".
 */
export function useWorksheetRename(
  worksheets: WorksheetDto[],
  scope: WorksheetRenameScope
) {
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const { worksheets: worksheetsCollection } = useCollections()

  // Three narrow reads rather than one of the session object: the surface that
  // is not editing would otherwise re-render on every keystroke in the other
  // one, and both are mounted the whole time.
  const editingWorksheetId = useAppSelector((state) =>
    state.editor.worksheetRename?.scope === scope
      ? state.editor.worksheetRename.worksheetId
      : null
  )
  const editingName = useAppSelector((state) =>
    state.editor.worksheetRename?.scope === scope
      ? state.editor.worksheetRename.draftName
      : ''
  )
  const renamedWorksheetId = useAppSelector(
    (state) => state.editor.worksheetRename?.worksheetId ?? null
  )

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingWorksheetId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingWorksheetId])

  const setEditingName = useCallback(
    (name: string) => {
      dispatch(worksheetRenameDraftUpdated(name))
    },
    [dispatch]
  )

  const commitRename = useCallback(
    (worksheetId: string, name: string) => {
      const trimmedName = name.trim()
      const worksheet = worksheets.find((w) => w.id === worksheetId)

      // An empty name, a worksheet that has since gone, or no change at all:
      // there is nothing to write, and blanking the name would be worse than
      // keeping it.
      if (!trimmedName || !worksheet || worksheet.name === trimmedName) {
        return
      }

      const transaction = worksheetsCollection.update(worksheetId, (draft) => {
        draft.name = trimmedName
      })

      void transaction.isPersisted.promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to rename worksheet', { description: message })
      })
    },
    [worksheetsCollection, worksheets]
  )

  const startEditing = useCallback(
    (worksheet: WorksheetDto) => {
      // Starting a session takes it from whoever had it, and React fires no
      // blur when that input unmounts with the focus staying put. Creating a
      // worksheet does exactly that: its rename opens from a resolved promise,
      // no click involved. Read the session now rather than from a selector so
      // this sees what is open at the moment of the take-over.
      const previous = store.getState().editor.worksheetRename

      if (previous && previous.worksheetId !== worksheet.id) {
        commitRename(previous.worksheetId, previous.draftName)
      }

      dispatch(
        worksheetRenameStarted({
          draftName: worksheet.name,
          scope,
          worksheetId: worksheet.id
        })
      )
    },
    [commitRename, dispatch, scope, store]
  )

  const handleRenameCancel = useCallback(() => {
    dispatch(worksheetRenameEnded())
  }, [dispatch])

  const handleRenameSubmit = useCallback(
    (worksheetId: string) => {
      // Closing the session first means the input is gone whether or not the
      // name changed, and the optimistic update rolls itself back on failure.
      handleRenameCancel()
      commitRename(worksheetId, editingName)
    },
    [commitRename, editingName, handleRenameCancel]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, worksheetId: string) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleRenameSubmit(worksheetId)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handleRenameCancel()
      }
    },
    [handleRenameCancel, handleRenameSubmit]
  )

  return {
    editingName,
    editingWorksheetId,
    handleKeyDown,
    handleRenameSubmit,
    inputRef,
    // A session whose worksheet has been deleted still holds the keyboard, and
    // nothing would ever end it — no input is mounted to blur or press Escape
    // in. Asking whether the worksheet is still here answers that without an
    // unmount effect, which StrictMode would fire spuriously.
    isRenaming:
      renamedWorksheetId !== null &&
      worksheets.some((worksheet) => worksheet.id === renamedWorksheetId),
    setEditingName,
    startEditing
  }
}
