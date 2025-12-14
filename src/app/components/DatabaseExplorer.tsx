import {
  ChevronRight,
  Database,
  Pencil,
  SearchIcon,
  Table2Icon
} from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import { editorSlice } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { Input } from './ui/input'
import { useAppDispatch, useAppSelector } from '../store'
import { Button } from './ui/button'
import { expandDatabase, expandTable } from '../store/database-explorer-slice'
import { cn } from '../lib/utils'

export function DatabaseExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)
  const expandedDatabases = useAppSelector(
    (state) => state.databaseExplorer.expandedDatabases
  )
  const expandedTables = useAppSelector(
    (state) => state.databaseExplorer.expandedTables
  )
  const schemas = useAppSelector((state) => state.editor.schemas)

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

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const query = event.target.value

      dispatch(editorSlice.actions.databaseSearchQueryUpdated(query))
    },
    [dispatch]
  )

  console.log({ schemas })

  return (
    <div className="flex flex-col h-full p-3">
      <h2 className="text-xs font-medium mb-2">Database Explorer</h2>

      <div className="mb-2">
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

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {filteredDatabases.map((database) => {
          const isDatabaseExpanded = Boolean(expandedDatabases[database.id])
          const tables = schemas[database.id]?.tables || []

          return (
            <div key={database.id}>
              <ContextMenu>
                <ContextMenuTrigger>
                  <Button
                    className="flex items-center gap-1 px-2 py-0 cursor-default h-5 font-normal"
                    size="sm"
                    variant="ghost"
                    onClick={() => dispatch(expandDatabase(database.id))}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3',
                        isDatabaseExpanded ? 'rotate-90' : ''
                      )}
                    />
                    <Database className="size-3" />
                    <span>{database.name}</span>
                  </Button>
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

              {isDatabaseExpanded && (
                <div className="flex flex-col gap-0.5 pl-4 pt-1">
                  {tables.map((table) => {
                    const tableKey = `${database.id}-${table.tableName}`
                    const isTableExpanded = Boolean(expandedTables[tableKey])

                    return (
                      <div
                        key={tableKey}
                        className="border-l border-surface-0"
                      >
                        <Button
                          className="flex items-center gap-1 px-2 py-0 cursor-default h-5 font-normal"
                          size="sm"
                          variant="ghost"
                          onClick={() => dispatch(expandTable(tableKey))}
                        >
                          <ChevronRight
                            className={cn(
                              'size-3',
                              isTableExpanded ? 'rotate-90' : ''
                            )}
                          />
                          <Table2Icon className="size-3" />
                          <span>{table.tableName}</span>
                        </Button>

                        {isTableExpanded && (
                          <div className="flex flex-col pl-4">
                            {table.columns.map((column) => (
                              <div
                                key={`${tableKey}-${column.columnName}`}
                                className="flex items-center gap-1 px-3 py-0.5 border-l border-surface-0"
                              >
                                <span className="text-xs text-muted-foreground">
                                  {column.columnName} ({column.dataType})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {filteredDatabases.length === 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            No databases found.
          </p>
        )}
      </div>
    </div>
  )
}
