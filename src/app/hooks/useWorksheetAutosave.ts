import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import invariant from 'tiny-invariant'

import { useCollections } from '../collections-context'

const saveDebounceMs = 300

export type SaveState = 'error' | 'idle' | 'saved' | 'saving'

export function useWorksheetAutosave(openWorksheetId: string | undefined) {
  const { worksheets: worksheetsCollection } = useCollections()

  const saveTimer = useRef<NodeJS.Timeout | undefined>(undefined)
  const pendingSave = useRef<{ content: string; id: string } | undefined>(
    undefined
  )
  const [saveState, setSaveState] = useState<SaveState>('idle')

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
        setSaveState('saved')
      })
      .catch(() => {
        setSaveState('error')
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

  const handleUpdateContent = useCallback(
    (newContent: string) => {
      invariant(openWorksheetId, 'No worksheet is open')

      pendingSave.current = { content: newContent, id: openWorksheetId }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }

      setSaveState('saving')

      saveTimer.current = setTimeout(flushSave, saveDebounceMs)
    },
    [flushSave, openWorksheetId]
  )

  return { handleUpdateContent, saveState }
}
