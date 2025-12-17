import { FileBracesIcon } from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { editorSlice } from '../store/editor-slice'
import { SearchInput } from './SearchInput'
import { Button } from './ui/button'

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

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-medium mb-2">Worksheets</h2>

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
