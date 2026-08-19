import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import invariant from 'tiny-invariant'

import { useCollections } from '../collections-context'

const saveDebounceMs = 300

export function useWorksheetAutosave(openWorksheetId: string | undefined) {
  const { worksheets: worksheetsCollection } = useCollections()

  const saveTimer = useRef<NodeJS.Timeout | undefined>(undefined)
  const pendingSave = useRef<{ content: string; id: string } | undefined>(
    undefined
  )
  // The worksheet is carried with the failure rather than beside it. Saves
  // settle in completion order and switching worksheets flushes the outgoing
  // one, so a failure normally lands after the worksheet it belongs to has
  // stopped being the open one — and a bare flag reported it against whichever
  // worksheet was open when it arrived.
  const [failedSave, setFailedSave] = useState<
    { worksheetId: string } | undefined
  >(undefined)

  // The answer to a save is handled long after the flush that sent it, so
  // neither the open worksheet nor the saves that have settled since can be
  // read out of that closure.
  const openWorksheetIdRef = useRef(openWorksheetId)

  useEffect(() => {
    openWorksheetIdRef.current = openWorksheetId
  }, [openWorksheetId])

  const sentSaves = useRef(0)
  const lastSettledSave = useRef(-1)

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }

    const pending = pendingSave.current

    if (!pending) {
      return
    }

    pendingSave.current = undefined

    // Deleting a worksheet takes its row out of the collection and moves the
    // app to another one, and both can happen inside the debounce window.
    // `update` on a key that is gone throws, and from the cleanup below that
    // takes the whole workspace down with it — for an edit the user deleted on
    // purpose.
    if (!worksheetsCollection.has(pending.id)) {
      return
    }

    const sequence = sentSaves.current
    sentSaves.current += 1

    const transaction = worksheetsCollection.update(pending.id, (draft) => {
      draft.content = pending.content
    })

    // Two saves for one worksheet can be open at once, and the older one has
    // nothing left to say once the newer has answered: its content is a prefix
    // of what was just stored.
    const isStale = (): boolean => sequence < lastSettledSave.current

    void transaction.isPersisted.promise
      .then(() => {
        if (isStale()) {
          return
        }

        lastSettledSave.current = sequence

        // Only this worksheet's own failure is cleared: a save that finally
        // lands for the worksheet you left says nothing about the one you are
        // looking at now.
        setFailedSave((current) =>
          current?.worksheetId === pending.id ? undefined : current
        )
      })
      .catch(() => {
        if (isStale()) {
          return
        }

        lastSettledSave.current = sequence

        // The toast reports the save wherever the user is now, because a save
        // that did not happen is worth knowing about either way. The status bar
        // notice is not: it describes the worksheet on screen, and the failed
        // content is no longer in it — a failed persist rolls the collection
        // back to the server's copy.
        if (pending.id === openWorksheetIdRef.current) {
          setFailedSave({ worksheetId: pending.id })
        }

        toast.error('Failed to save worksheet')
      })
  }, [worksheetsCollection])

  useEffect(() => {
    // Flush any pending save when switching worksheets or unmounting so the
    // last edits are never dropped inside the debounce window.
    return () => {
      flushSave()
    }
  }, [flushSave, openWorksheetId])

  // The notice belongs to the worksheet that was on screen when the save
  // failed, and leaving takes the failed content with it. Coming back to a
  // worksheet still labelled "Save failed" would point at text that matches
  // what is stored.
  useEffect(() => {
    setFailedSave(undefined)
  }, [openWorksheetId])

  const queueSave = useCallback(
    (newContent: string) => {
      invariant(openWorksheetId, 'No worksheet is open')

      pendingSave.current = { content: newContent, id: openWorksheetId }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }

      saveTimer.current = setTimeout(flushSave, saveDebounceMs)
    },
    [flushSave, openWorksheetId]
  )

  // `flushSave` is exposed so callers that need the saved copy to be current —
  // running a query — can close the debounce window instead of waiting it out.
  return {
    flushSave,
    hasSaveFailed: failedSave !== undefined,
    queueSave
  }
}
