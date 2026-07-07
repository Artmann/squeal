import {
  ChevronRight,
  Database,
  Pencil,
  Plus,
  SearchIcon,
  Table2Icon
} from 'lucide-react'
import { ReactElement, useCallback } from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { useDatabases, useDatabaseSchema } from '../hooks/queries'
import { useCreateWorksheet } from '../hooks/mutations'
import {
  databaseSearchQueryUpdated,
  worksheetSelected
} from '../store/editor-slice'
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
import { DatabaseDto } from '@/glue/databases'

export function DatabaseExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useDatabases()
  const expandedDatabases = useAppSelector(
    (state) => state.databaseExplorer.expandedDatabases
  )

  const databaseSearchQuery = useAppSelector(
    (state) => state.editor.databaseSearchQuery ?? ''
  )

  const filteredDatabases = databases.data.filter((database) =>
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
            dispatch(databaseSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {filteredDatabases.map((database) => (
          <DatabaseRow
            key={database.id}
            database={database}
            isExpanded={Boolean(expandedDatabases[database.id])}
            onEdit={handleEditDatabase}
          />
        ))}

        {filteredDatabases.length === 0 &&
          (databaseSearchQuery ? (
            <p className="text-xs text-muted-foreground mt-2 px-1">
              No databases match “{databaseSearchQuery}”.
            </p>
          ) : (
            <div className="text-xs text-muted-foreground mt-2 px-1 leading-relaxed">
              <p>Connect a database to browse its tables and columns here.</p>

              <Button
                className="mt-2 h-auto p-0 text-xs"
                variant="link"
                onClick={handleCreateDatabase}
              >
                Add a database
              </Button>
            </div>
          ))}
      </div>
    </div>
  )
}

interface DatabaseRowProps {
  database: DatabaseDto
  isExpanded: boolean
  onEdit: (databaseId: string) => void
}

function DatabaseRow({
  database,
  isExpanded,
  onEdit
}: DatabaseRowProps): ReactElement {
  const dispatch = useAppDispatch()
  const expandedTables = useAppSelector(
    (state) => state.databaseExplorer.expandedTables
  )
  const schema = useDatabaseSchema(isExpanded ? database.id : undefined)

  const createWorksheet = useCreateWorksheet()
  const { worksheets: worksheetsCollection } = useCollections()

  const tables = schema.data?.tables ?? []

  const handleQueryTable = useCallback(
    (tableName: string) => {
      createWorksheet.mutate(
        {
          content: `SELECT * FROM ${tableName} LIMIT 100`,
          databaseId: database.id,
          name: tableName
        },
        {
          onSuccess: (worksheet) => {
            dispatch(worksheetSelected(worksheet.id))

            if (worksheetsCollection.status === 'ready') {
              const transaction = worksheetsCollection.update(
                worksheet.id,
                (draft) => {
                  draft.lastOpenedAt = Date.now()
                }
              )

              void transaction.isPersisted.promise.catch((): void => undefined)
            }
          },
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : 'Unknown error'

            toast.error('Failed to create worksheet', { description: message })
          }
        }
      )
    },
    [createWorksheet, database.id, dispatch, worksheetsCollection]
  )

  return (
    <div>
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
                isExpanded ? 'rotate-90' : ''
              )}
            />
            <Database className="size-3" />
            <span className="text-xs">{database.name}</span>
          </Button>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            className="flex items-center gap-2 min-w-32 text-xs"
            onClick={() => onEdit(database.id)}
          >
            <Pencil className="size-3" />
            Edit
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && (
        <div className="flex flex-col gap-0.5 pl-4 pt-1">
          {tables.map((table) => {
            const tableKey = `${database.id}-${table.tableName}`
            const isTableExpanded = Boolean(expandedTables[tableKey])

            return (
              <div
                key={tableKey}
                className="border-l border-surface-0"
              >
                <ContextMenu>
                  <ContextMenuTrigger>
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
                  </ContextMenuTrigger>

                  <ContextMenuContent>
                    <ContextMenuItem
                      className="flex items-center gap-2 min-w-32 text-xs"
                      onClick={() => handleQueryTable(table.tableName)}
                    >
                      <SearchIcon className="size-3" />
                      Query Table
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

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
}
