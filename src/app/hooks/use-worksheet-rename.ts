import React, { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { WorksheetDto } from '@/glue/worksheets'

export type WorksheetRenameControls = ReturnType<typeof useWorksheetRename>

/**
 * Inline renaming, shared by the sidebar list and the tab strip: which
 * worksheet is being edited, the draft name, and the commit that writes it
 * through the collection. The update is optimistic, so a rejected save rolls
 * back on its own and only needs a toast.
 */
export function useWorksheetRename(worksheets: WorksheetDto[]) {
  const { worksheets: worksheetsCollection } = useCollections()

  const [editingWorksheetId, setEditingWorksheetId] = useState<string | null>(
    null
  )
  const [editingName, setEditingName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingWorksheetId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingWorksheetId])

  const startEditing = useCallback((worksheet: WorksheetDto) => {
    setEditingWorksheetId(worksheet.id)
    setEditingName(worksheet.name)
  }, [])

  const handleRenameCancel = useCallback(() => {
    setEditingWorksheetId(null)
    setEditingName('')
  }, [])

  const handleRenameSubmit = useCallback(
    (worksheetId: string) => {
      const trimmedName = editingName.trim()

      if (!trimmedName) {
        handleRenameCancel()

        return
      }

      const worksheet = worksheets.find((w) => w.id === worksheetId)

      if (!worksheet || worksheet.name === trimmedName) {
        handleRenameCancel()

        return
      }

      setEditingWorksheetId(null)

      const transaction = worksheetsCollection.update(worksheetId, (draft) => {
        draft.name = trimmedName
      })

      void transaction.isPersisted.promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to rename worksheet', { description: message })
      })

      setEditingName('')
    },
    [editingName, handleRenameCancel, worksheetsCollection, worksheets]
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
    setEditingName,
    startEditing
  }
}
