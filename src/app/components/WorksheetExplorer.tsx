import dayjs from 'dayjs'
import { FileBracesIcon, PlusIcon } from 'lucide-react'
import { ReactElement, useCallback } from 'react'
import { toast } from 'sonner'
import { v4 as uuid } from 'uuid'

import { apiClient } from '../api-client'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { editorSlice } from '../store/editor-slice'
import { Button } from './ui/button'
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
      await apiClient.createWorksheet(name)
    } catch (error) {
      dispatch(editorSlice.actions.worksheetRemoved(optimisticId))

      const message = error instanceof Error ? error.message : 'Unknown error'

      toast.error('Failed to create worksheet', { description: message })
    }
  }, [dispatch])

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
        {worksheets.map((worksheet) => (
          <Button
            key={worksheet.id}
            className={cn(
              'w-full px-3 py-0.5 text-left flex justify-start items-center gap-2 text-xs',
              worksheet.id === openWorksheetId ? 'bg-surface-0' : ''
            )}
            size="sm"
            variant="ghost"
            onClick={() => handleSelectWorksheet(worksheet.id)}
          >
            <FileBracesIcon />
            {worksheet.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
