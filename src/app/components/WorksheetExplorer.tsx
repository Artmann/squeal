import dayjs from 'dayjs'
import { FileBracesIcon, PlusIcon } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { v4 as uuid } from 'uuid'

import { apiClient } from '../api-client'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { editorSlice } from '../store/editor-slice'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SearchInput } from './SearchInput'
import { WorksheetDto } from '@/glue/worksheets'

export function WorksheetExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const worksheetSearchQuery = useAppSelector(
    (state) => state.editor.worksheetSearchQuery ?? ''
  )

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

  const filteredWorksheets = worksheets.filter((worksheet) =>
    worksheet.name.toLowerCase().includes(worksheetSearchQuery.toLowerCase())
  )
  const sortedWorksheets = filteredWorksheets.sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(editorSlice.actions.worksheetSelected(worksheetId))
    },
    [dispatch]
  )

  const handleNewWorksheet = useCallback(async () => {
    const optimisticId = uuid()
    const name = `Worksheet ${dayjs().format('MM/DD/YYYY HH:mm:ss')}`

    const optimisticWorksheet: WorksheetDto = {
      content: '',
      createdAt: Date.now(),
      databaseId: null,
      id: optimisticId,
      name
    }

    dispatch(editorSlice.actions.worksheetCreated(optimisticWorksheet))

    try {
      const worksheet = await apiClient.createWorksheet(name)

      // Replace optimistic worksheet with real one from API
      dispatch(editorSlice.actions.worksheetRemoved(optimisticId))
      dispatch(editorSlice.actions.worksheetCreated(worksheet))
    } catch (error) {
      dispatch(editorSlice.actions.worksheetRemoved(optimisticId))

      const message = error instanceof Error ? error.message : 'Unknown error'

      toast.error('Failed to create worksheet', { description: message })
    }
  }, [dispatch])

  const handleDoubleClick = useCallback((worksheet: WorksheetDto) => {
    setEditingWorksheetId(worksheet.id)
    setEditingName(worksheet.name)
  }, [])

  const handleRenameCancel = useCallback(() => {
    setEditingWorksheetId(null)
    setEditingName('')
  }, [])

  const handleRenameSubmit = useCallback(
    async (worksheetId: string) => {
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

      try {
        const updatedWorksheet = await apiClient.updateWorksheet(worksheetId, {
          name: trimmedName
        })

        dispatch(editorSlice.actions.worksheetUpdated(updatedWorksheet))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to rename worksheet', { description: message })
      }

      setEditingName('')
    },
    [dispatch, editingName, handleRenameCancel, worksheets]
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

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2 flex justify-between items-center">
        <h2 className="text-xs font-medium">Worksheets</h2>
        <div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleNewWorksheet}
          >
            <PlusIcon className="size-3" />
          </Button>
        </div>
      </div>

      <div className="mb-2">
        <SearchInput
          value={worksheetSearchQuery}
          onChange={(newValue) =>
            dispatch(editorSlice.actions.worksheetSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {sortedWorksheets.map((worksheet) =>
          editingWorksheetId === worksheet.id ? (
            <div
              key={worksheet.id}
              className="flex items-center gap-2 px-3 py-0.5"
            >
              <FileBracesIcon className="size-4 shrink-0" />
              <Input
                ref={inputRef}
                className="h-5 text-[11px] px-1 py-0"
                value={editingName}
                onBlur={() => handleRenameSubmit(worksheet.id)}
                onChange={(event) => setEditingName(event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, worksheet.id)}
              />
            </div>
          ) : (
            <Button
              key={worksheet.id}
              className={cn(
                'w-full px-3 py-0.5 text-left flex justify-start items-center gap-2 text-xs font-normal',
                worksheet.id === openWorksheetId ? 'bg-surface-0' : ''
              )}
              size="sm"
              variant="ghost"
              onClick={() => handleSelectWorksheet(worksheet.id)}
              onDoubleClick={() => handleDoubleClick(worksheet)}
            >
              <FileBracesIcon />
              {worksheet.name}
            </Button>
          )
        )}
      </div>
    </div>
  )
}
