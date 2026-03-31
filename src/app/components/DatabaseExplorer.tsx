import { ChevronRight, Database, Pencil, Plus, Table2Icon } from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import { editorSlice } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { expandDatabase, expandTable } from '../store/database-explorer-slice'
import { SearchInput } from './SearchInput'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'

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

  const handleCreateDatabase = useCallback(() => {
    dispatch(uiActions.openCreateDatabase())
  }, [dispatch])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-subtext-0">
          Database Explorer
        </h2>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={handleCreateDatabase}
        >
          <Plus className="size-3" />
        </Button>
      </div>

      <div className="mb-2">
        <SearchInput
          value={databaseSearchQuery}
          onChange={(newValue) =>
            dispatch(editorSlice.actions.databaseSearchQueryUpdated(newValue))
          }
        />
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
                    className="flex justify-start items-center gap-1 -ml-2 px-0 py-1 cursor-default h-5 font-normal w-full"
                    size="sm"
                    variant="ghost"
                    onClick={() => dispatch(expandDatabase(database.id))}
                  >
                    <ChevronRight
                      className={cn(
                        'size-3 transition-transform duration-150',
                        isDatabaseExpanded ? 'rotate-90' : ''
                      )}
                    />
                    <Database className="size-3" />
                    <span className="text-xs">{database.name}</span>
                  </Button>
                </ContextMenuTrigger>

                <ContextMenuContent>
                  <ContextMenuItem
                    className="flex items-center gap-2 min-w-32 text-xs"
                    onClick={() => handleEditDatabase(database.id)}
                  >
                    <Pencil className="size-3" />
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
                          className="flex items-center gap-1 px-0 py-0 cursor-default h-5 font-normal"
                          size="sm"
                          variant="ghost"
                          onClick={() => dispatch(expandTable(tableKey))}
                        >
                          <ChevronRight
                            className={cn(
                              'size-3 transition-transform duration-150',
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
          <div className="text-xs text-muted-foreground mt-2">
            <p>No databases found.</p>

            <Button
              className="mt-2 h-auto p-0 text-xs"
              variant="link"
              onClick={handleCreateDatabase}
            >
              Add a database
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
