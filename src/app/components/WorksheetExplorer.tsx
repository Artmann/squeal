import { FileBracesIcon, PlusIcon } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useWorksheets } from '../hooks/queries'
import {
  useCreateWorksheet,
  useUpdateWorksheet
} from '../hooks/mutations'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import {
  worksheetSearchQueryUpdated,
  worksheetSelected
} from '../store/editor-slice'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { SearchInput } from './SearchInput'
import { WorksheetDto } from '@/glue/worksheets'

export function WorksheetExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const worksheetSearchQuery = useAppSelector(
    (state) => state.editor.worksheetSearchQuery ?? ''
  )

  const createWorksheet = useCreateWorksheet()
  const updateWorksheet = useUpdateWorksheet()

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

  const filteredWorksheets = worksheets.data.filter((worksheet) =>
    worksheet.name.toLowerCase().includes(worksheetSearchQuery.toLowerCase())
  )
  const sortedWorksheets = filteredWorksheets.sort((a, b) =>
    a.createdAt > b.createdAt ? -1 : 1
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(worksheetSelected(worksheetId))

      updateWorksheet.mutate({
        id: worksheetId,
        updates: { lastOpenedAt: Date.now() }
      })
    },
    [dispatch, updateWorksheet]
  )

  const handleNewWorksheet = useCallback(() => {
    const untitledCount = worksheets.data.filter(
      (w) => w.name === 'Untitled' || /^Untitled \d+$/.test(w.name)
    ).length
    const name =
      untitledCount === 0 ? 'Untitled' : `Untitled ${untitledCount + 1}`

    createWorksheet.mutate(name, {
      onSuccess: (worksheet) => {
        dispatch(worksheetSelected(worksheet.id))

        updateWorksheet.mutate({
          id: worksheet.id,
          updates: { lastOpenedAt: Date.now() }
        })

        setEditingWorksheetId(worksheet.id)
        setEditingName(worksheet.name)
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to create worksheet', { description: message })
      }
    })
  }, [createWorksheet, dispatch, updateWorksheet, worksheets.data])

  const handleDoubleClick = useCallback((worksheet: WorksheetDto) => {
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

      const worksheet = worksheets.data.find((w) => w.id === worksheetId)

      if (!worksheet || worksheet.name === trimmedName) {
        handleRenameCancel()

        return
      }

      setEditingWorksheetId(null)

      updateWorksheet.mutate(
        { id: worksheetId, updates: { name: trimmedName } },
        {
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : 'Unknown error'

            toast.error('Failed to rename worksheet', { description: message })
          }
        }
      )

      setEditingName('')
    },
    [editingName, handleRenameCancel, updateWorksheet, worksheets.data]
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
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-subtext-0">
          Worksheets
        </h2>
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
            dispatch(worksheetSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {sortedWorksheets.length === 0 && (
          <p className="text-xs text-subtext-0 px-1 mt-1">
            No worksheets yet.{' '}
            <button
              className="underline underline-offset-2 hover:text-text transition-colors"
              onClick={handleNewWorksheet}
            >
              Create one
            </button>
          </p>
        )}

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
                worksheet.id === openWorksheetId
                  ? 'bg-mauve/10 text-mauve shadow-[inset_2px_0_0_var(--color-mauve)]'
                  : ''
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
