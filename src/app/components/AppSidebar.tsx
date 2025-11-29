import { Database } from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import { useAppDispatch, useAppSelector } from '../store'
import { Separator } from './ui/separator'
import { cn } from '../lib/utils'
import { workspaceSelected } from '../store/editor-slice'

export function AppSidebar(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)
  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(workspaceSelected(worksheetId))
    },
    [dispatch]
  )

  return (
    <div className="flex flex-col gap-8  text-xs w-60">
      <div className="flex-1 min-h-0 p-3">
        <Heading text="Worksheets" />

        <div className="px-2">
          {worksheets.map((worksheet) => (
            <button
              key={worksheet.id}
              className={cn(
                'w-full cursor-pointer px-3 py-0.5 text-left',
                worksheet.id === openWorksheetId
                  ? 'border-mauve border-l-2'
                  : 'border-surface-0 border-l'
              )}
              onClick={() => handleSelectWorksheet(worksheet.id)}
            >
              {worksheet.name}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="p-3">
        <Heading text="Database Explorer" />

        <div className="">
          {databases.map((database) => (
            <div
              key={database.id}
              className="flex items-center gap-2 py-0.5"
            >
              <Database className="h-3 w-3 text-mauve" />
              <span>{database.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Heading({ text }: { text: string }) {
  return <h2 className="text-xs font-medium mb-2">{text}</h2>
}
