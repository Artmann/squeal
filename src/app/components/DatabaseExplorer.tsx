import { closestCenter, DndContext } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronRight,
  Database,
  Pencil,
  Plus,
  SearchIcon,
  Table2Icon,
  Trash2
} from 'lucide-react'
import { ReactElement, useCallback } from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import {
  useDatabases,
  useDatabaseSchema,
  useDatabaseSchemas
} from '../hooks/queries'
import {
  useCreateWorksheet,
  useDeleteDatabase,
  useReorderDatabases
} from '../hooks/mutations'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
import { useReorderDrag } from '../hooks/use-reorder-drag'
import {
  databaseSearchQueryUpdated,
  worksheetSelected
} from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { expandDatabase, expandTable } from '../store/database-explorer-slice'
import { computeDatabaseMatch, DatabaseMatch } from './database-explorer-search'
import { SearchInput } from './SearchInput'
import { Button } from './ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import type { SchemaInfo, TableInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import { DropIndicatorLine } from './DropIndicatorLine'

interface RenderedDatabaseRow {
  database: DatabaseDto
  hasMultipleSchemas: boolean
  searchMatch?: DatabaseMatch
}

// Builds the rows to render: while searching, only databases with a match
// (and their matching tables) survive; otherwise every database is shown.
// Each row notes whether its database spans multiple schemas, so duplicate
// table names (common across schemas) stay distinguishable without adding
// noise to single-schema databases.
function computeRenderedRows(
  databases: DatabaseDto[],
  schemas: (SchemaInfo | undefined)[],
  searchQuery: string
): RenderedDatabaseRow[] {
  const isSearching = searchQuery.trim().length > 0

  const rows = databases.map((database, index) => ({
    database,
    hasMultipleSchemas: spansMultipleSchemas(schemas[index]),
    searchMatch: isSearching
      ? (computeDatabaseMatch(database, schemas[index], searchQuery) ??
        undefined)
      : undefined
  }))

  if (!isSearching) {
    return rows
  }

  return rows.filter((row) => row.searchMatch !== undefined)
}

function spansMultipleSchemas(schema: SchemaInfo | undefined): boolean {
  const schemaNames = new Set(
    (schema?.tables ?? []).map((table) => table.tableSchema)
  )

  return schemaNames.size > 1
}

// Deleting purges the stored secret, so it asks for confirmation via an
// action toast — ignoring it is a safe no.
function useConfirmedDatabaseDeletion(): (database: DatabaseDto) => void {
  const deleteDatabase = useDeleteDatabase()

  return useCallback(
    (database: DatabaseDto) => {
      toast(`Delete "${database.name}"?`, {
        action: {
          label: 'Delete',
          onClick: () => {
            deleteDatabase.mutate(database.id, {
              onError: (error) => {
                const message =
                  error instanceof Error ? error.message : 'Unknown error'

                toast.error('Failed to delete database', {
                  description: message
                })
              },
              onSuccess: () => {
                toast.success(`Deleted "${database.name}"`)
              }
            })
          }
        },
        description:
          'The stored connection details, including its password, will be removed. Worksheets and query history are kept.'
      })
    },
    [deleteDatabase]
  )
}

// Opens a fresh worksheet querying the given table and marks it as the open,
// most recently used one.
function useQueryTableWorksheet(
  databaseId: string
): (tableName: string) => void {
  const createWorksheet = useCreateWorksheet()
  const dispatch = useAppDispatch()
  const { worksheets: worksheetsCollection } = useCollections()

  return useCallback(
    (tableName: string) => {
      createWorksheet.mutate(
        {
          content: `SELECT * FROM ${tableName} LIMIT 100`,
          databaseId,
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
    [createWorksheet, databaseId, dispatch, worksheetsCollection]
  )
}

export function DatabaseExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useDatabases()
  const expandedDatabases = useAppSelector(
    (state) => state.databaseExplorer.expandedDatabases
  )

  const databaseSearchQuery = useAppSelector(
    (state) => state.editor.databaseSearchQuery ?? ''
  )

  const isSearching = databaseSearchQuery.trim().length > 0

  // Prefetch every schema in the background so search and expansion are instant,
  // and reuse those results as the source for matching tables and columns.
  const schemaResults = useDatabaseSchemas(
    databases.data.map((database) => database.id)
  )

  const renderedRows = computeRenderedRows(
    databases.data,
    schemaResults.map((result) => result.data),
    databaseSearchQuery
  )

  // While a search is settling, some schemas may still be loading, so hold off
  // on the "no matches" message until they have resolved.
  const isLoadingSchemas =
    isSearching && schemaResults.some((result) => result.isLoading)

  // Reordering a filtered subset is ambiguous, so dragging only works on the
  // full list.
  const isSortingDisabled = isSearching
  const reorderDatabases = useReorderDatabases()

  const renderedDatabaseIds = renderedRows.map((row) => row.database.id)
  const {
    dropIndicatorFor,
    handleDragOver,
    handleDragStart,
    resetDropIndicator
  } = useDropIndicator(renderedDatabaseIds)

  const { handleDragEnd, sensors } = useReorderDrag({
    ids: databases.data.map((database) => database.id),
    onReorder: reorderDatabases.mutate,
    resetDropIndicator
  })

  const handleEditDatabase = useCallback(
    (databaseId: string) => {
      dispatch(uiActions.openEditDatabase(databaseId))
    },
    [dispatch]
  )

  const handleDeleteDatabase = useConfirmedDatabaseDeletion()

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
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          sensors={sensors}
          onDragCancel={resetDropIndicator}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
        >
          <SortableContext
            items={renderedDatabaseIds}
            strategy={staticListStrategy}
          >
            {renderedRows.map((row, index) => (
              <DatabaseRow
                key={row.database.id}
                database={row.database}
                dropIndicator={dropIndicatorFor(index)}
                hasMultipleSchemas={row.hasMultipleSchemas}
                isExpanded={Boolean(expandedDatabases[row.database.id])}
                isSortingDisabled={isSortingDisabled}
                searchMatch={row.searchMatch}
                onDelete={handleDeleteDatabase}
                onEdit={handleEditDatabase}
              />
            ))}
          </SortableContext>
        </DndContext>

        {renderedRows.length === 0 &&
          !isLoadingSchemas &&
          (isSearching ? (
            <p className="text-xs text-muted-foreground mt-2 px-1">
              No matches for “{databaseSearchQuery}”.
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
  dropIndicator: DropIndicator
  hasMultipleSchemas: boolean
  isExpanded: boolean
  isSortingDisabled: boolean
  onDelete: (database: DatabaseDto) => void
  onEdit: (databaseId: string) => void
  searchMatch?: DatabaseMatch
}

// While searching, a matching row is forced open to reveal its tables.
function isRowExpanded(
  searchMatch: DatabaseMatch | undefined,
  isExpanded: boolean
): boolean {
  return searchMatch ? searchMatch.expandDatabase || isExpanded : isExpanded
}

function DatabaseRow({
  database,
  dropIndicator,
  hasMultipleSchemas,
  isExpanded,
  isSortingDisabled,
  onDelete,
  onEdit,
  searchMatch
}: DatabaseRowProps): ReactElement {
  const isDatabaseExpanded = isRowExpanded(searchMatch, isExpanded)

  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ disabled: isSortingDisabled, id: database.id })

  return (
    // The transform lives on the wrapper so an expanded subtree moves with the
    // row, while only the row button acts as the drag handle.
    <div
      ref={setNodeRef}
      className={cn('relative', isDragging && 'opacity-50')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dropIndicator && <DropIndicatorLine position={dropIndicator} />}

      <DatabaseRowHeader
        database={database}
        isExpanded={isDatabaseExpanded}
        // While filtering only dragging is off, so skip the sortable props
        // entirely — spreading them would mark the row aria-disabled even
        // though clicking still works.
        sortableProps={isSortingDisabled ? {} : { ...attributes, ...listeners }}
        onDelete={onDelete}
        onEdit={onEdit}
      />

      {isDatabaseExpanded && (
        <DatabaseTableList
          database={database}
          hasMultipleSchemas={hasMultipleSchemas}
          searchMatch={searchMatch}
        />
      )}
    </div>
  )
}

interface DatabaseRowHeaderProps {
  database: DatabaseDto
  isExpanded: boolean
  onDelete: (database: DatabaseDto) => void
  onEdit: (databaseId: string) => void
  sortableProps: Record<string, unknown>
}

function DatabaseRowHeader({
  database,
  isExpanded,
  onDelete,
  onEdit,
  sortableProps
}: DatabaseRowHeaderProps): ReactElement {
  const dispatch = useAppDispatch()

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Button
          {...sortableProps}
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

        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs text-destructive focus:text-destructive"
          onClick={() => onDelete(database)}
        >
          <Trash2 className="size-3" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface DatabaseTableListProps {
  database: DatabaseDto
  hasMultipleSchemas: boolean
  searchMatch?: DatabaseMatch
}

function DatabaseTableList({
  database,
  hasMultipleSchemas,
  searchMatch
}: DatabaseTableListProps): ReactElement {
  const dispatch = useAppDispatch()
  const expandedTables = useAppSelector(
    (state) => state.databaseExplorer.expandedTables
  )

  // While searching, the tables come from the precomputed match, so the lazy
  // fetch is skipped; otherwise the list only mounts once the row is
  // expanded, which is exactly when the schema is needed.
  const schema = useDatabaseSchema(searchMatch ? undefined : database.id)

  const handleQueryTable = useQueryTableWorksheet(database.id)

  const tables = searchMatch?.tables ?? schema.data?.tables ?? []

  return (
    <div className="flex flex-col gap-0.5 pl-4 pt-1">
      {tables.map((table) => {
        // Table names repeat across schemas, so the key must include the
        // schema — otherwise same-named tables collide and expanding one
        // toggles them all.
        const tableKey = `${database.id}-${table.tableSchema}-${table.tableName}`

        return (
          <DatabaseTableRow
            key={tableKey}
            hasMultipleSchemas={hasMultipleSchemas}
            isExpanded={Boolean(expandedTables[tableKey])}
            table={table}
            onQueryTable={handleQueryTable}
            onToggle={() => dispatch(expandTable(tableKey))}
          />
        )
      })}
    </div>
  )
}

interface DatabaseTableRowProps {
  hasMultipleSchemas: boolean
  isExpanded: boolean
  onQueryTable: (tableName: string) => void
  onToggle: () => void
  table: TableInfo
}

function DatabaseTableRow({
  hasMultipleSchemas,
  isExpanded,
  onQueryTable,
  onToggle,
  table
}: DatabaseTableRowProps): ReactElement {
  return (
    <div className="border-l border-surface-0">
      <ContextMenu>
        <ContextMenuTrigger>
          <Button
            className="flex items-center gap-1 px-0 py-0 cursor-default h-5 font-normal"
            size="sm"
            variant="ghost"
            onClick={onToggle}
          >
            <ChevronRight
              className={cn(
                'size-3 transition-transform duration-150',
                isExpanded ? 'rotate-90' : ''
              )}
            />
            <Table2Icon className="size-3 shrink-0" />
            <span className="truncate">{table.tableName}</span>

            {hasMultipleSchemas && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {table.tableSchema}
              </span>
            )}
          </Button>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            className="flex items-center gap-2 min-w-32 text-xs"
            onClick={() => onQueryTable(table.tableName)}
          >
            <SearchIcon className="size-3" />
            Query Table
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && (
        <div className="flex flex-col pl-4">
          {table.columns.map((column) => (
            <div
              key={`${table.tableSchema}-${table.tableName}-${column.columnName}`}
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
}
