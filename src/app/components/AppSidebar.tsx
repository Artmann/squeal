import { ReactElement, useCallback } from 'react'

import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'

import { Separator } from './ui/separator'
import { DatabaseExplorer } from './DatabaseExplorer'
import { worksheetSelected } from '../store/editor-slice'
import { WorksheetExplorer } from './WorksheetExplorer'

export function AppSidebar(): ReactElement {
  const dispatch = useAppDispatch()

  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(worksheetSelected(worksheetId))
    },
    [dispatch]
  )

  return (
    <div className="flex flex-col gap-2 text-xs w-80 h-full">
      <div className="flex-1 min-h-0 p-3">
        <WorksheetExplorer />
      </div>

      <Separator />

      <div className="flex-1 min-h-0">
        <DatabaseExplorer />
      </div>
    </div>
  )
}
