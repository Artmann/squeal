import { Database, SearchIcon } from 'lucide-react'
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
import { Separator } from './ui/separator'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'

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

        <div className="mb-4">
          <InputGroup className="h-6 focus-within:ring-0 focus-within:border-input [&:has([data-slot=input-group-control]:focus-visible)]:border-input [&:has([data-slot=input-group-control]:focus-visible)]:ring-0">
            <InputGroupInput
              className="text-[10px] py-0 focus-visible:ring-0"
              placeholder="Search..."
              value={databaseSearchQuery}
              onChange={handleSearchChange}
            />
            <InputGroupAddon className="py-0">
              <SearchIcon className="size-3 mt-0.5" />
            </InputGroupAddon>
          </InputGroup>
        </div>

        <div className="">
          {filteredDatabases.map((database) => (
            <ContextMenu key={database.id}>
              <ContextMenuTrigger>
                <div className="flex items-center gap-2 py-0.5 cursor-default">
                  <Database className="h-3 w-3" />
                  <span>{database.name}</span>
                </div>
              </ContextMenuTrigger>

              <ContextMenuContent>
                <ContextMenuItem
                  onClick={() => handleEditDatabase(database.id)}
                >
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
