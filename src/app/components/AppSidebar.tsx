import { Database, Pencil, SearchIcon } from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { editorSlice, workspaceSelected } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { Input } from './ui/input'
import { Separator } from './ui/separator'

export function AppSidebar(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)
  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const databaseSearchQuery = useAppSelector(
    (state) => state.editor.databaseSearchQuery ?? ''
  )

  const filteredDatabases = databases.filter((database) =>
    database.name.toLowerCase().includes(databaseSearchQuery.toLowerCase())
  )

  const handleEditDatabase = useCallback(
    (databaseId: string) => {
      dispatch(uiActions.openEditDatabase(databaseId))
    },
    [dispatch]
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(workspaceSelected(worksheetId))
    },
    [dispatch]
  )

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const query = event.target.value

      dispatch(editorSlice.actions.databaseSearchQueryUpdated(query))
    },
    [dispatch]
  )

  return (
    <div className="flex flex-col gap-2 text-xs w-60">
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

        <div className="mb-4">
          <div className="mb-2 relative">
            <Input
              className="pl-7 py-0"
              placeholder="Search..."
              value={databaseSearchQuery}
              style={{ fontSize: '12px' }}
              onChange={handleSearchChange}
            />

            <SearchIcon className="absolute size-3 left-3 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {filteredDatabases.map((database) => (
            <ContextMenu key={database.id}>
              <ContextMenuTrigger>
                <div className="flex items-center gap-2 py-0.5 cursor-default">
                  <Database className="size-3" />
                  <span>{database.name}</span>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent>
                <ContextMenuItem
                  className="flex items-center gap-3 min-w-32"
                  onClick={() => handleEditDatabase(database.id)}
                >
                  <Pencil className="size-4" />
                  Edit
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}

          {filteredDatabases.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              No databases found.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Heading({ text }: { text: string }) {
  return <h2 className="text-xs font-medium mb-2">{text}</h2>
}
