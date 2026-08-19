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
  // resolve in completion order and switching worksheets flushes the outgoing
  // one, so a failure normally lands after the worksheet it belongs to has
  // stopped being the open one — and a bare flag reported it against whichever
  // worksheet was open when it arrived.
  const [failedSave, setFailedSave] = useState<{ worksheetId: string } | null>(
    null
  )

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

    const transaction = worksheetsCollection.update(pending.id, (draft) => {
      draft.content = pending.content
    })

    void transaction.isPersisted.promise
      .then(() => {
        // Only this worksheet's own failure is cleared: a save that finally
        // lands for the worksheet you left says nothing about the one you are
        // looking at now.
        setFailedSave((current) =>
          current?.worksheetId === pending.id ? null : current
        )
      })
      .catch(() => {
        setFailedSave({ worksheetId: pending.id })
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
    // Derived rather than reset when the worksheet changes, so coming back to a
    // worksheet whose last save failed still says so — those edits really are
    // unsaved. Compared against the record rather than through `?.`, which
    // would answer `undefined === undefined` with "failed" before any worksheet
    // is open.
    hasSaveFailed:
      failedSave !== null && failedSave.worksheetId === openWorksheetId,
    queueSave
  }
}
