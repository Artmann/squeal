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
import { useStartQuery } from '../hooks/use-start-query'
import { databaseSearchQueryUpdated } from '../store/editor-slice'
import { tabsActions } from '../store/tabs-slice'
import { uiActions } from '../store/ui-slice'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { expandDatabase, expandTable } from '../store/database-explorer-slice'
import { computeDatabaseMatch, DatabaseMatch } from './database-explorer-search'
import { SearchInput } from './SearchInput'
import { buildTableQuery } from './table-query'
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

// Opens a fresh worksheet querying the given table, marks it as the open, most
// recently used one, and runs the query so the table's rows are there without a
// second click.
function useQueryTableWorksheet(
  database: DatabaseDto,
  hasMultipleSchemas: boolean
): (table: TableInfo) => void {
  const createWorksheet = useCreateWorksheet()
  const dispatch = useAppDispatch()
  const startQuery = useStartQuery()
  const { worksheets: worksheetsCollection } = useCollections()

  return useCallback(
    (table: TableInfo) => {
      const content = buildTableQuery(table, database.type, hasMultipleSchemas)

      createWorksheet.mutate(
        {
          content,
          databaseId: database.id,
          name: table.tableName
        },
        {
          onSuccess: (worksheet) => {
            dispatch(tabsActions.tabOpened(worksheet.id))

            if (worksheetsCollection.status === 'ready') {
              const transaction = worksheetsCollection.update(
                worksheet.id,
                (draft) => {
                  draft.lastOpenedAt = Date.now()
                }
              )

              void transaction.isPersisted.promise.catch((): void => undefined)
            }

            // The tab is already open, so the results land in front of the
            // user. `notifyOnError` covers the case where they look away.
            startQuery({
              content,
              databaseId: worksheet.databaseId ?? database.id,
              notifyOnError: true,
              worksheetId: worksheet.id
            })
          },
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : 'Unknown error'

            toast.error('Failed to create worksheet', { description: message })
          }
        }
      )
    },
    [
      createWorksheet,
      database,
      dispatch,
      hasMultipleSchemas,
      startQuery,
      worksheetsCollection
    ]
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between pt-[10px] pr-3 pb-2 pl-4">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text3 uppercase">
          Databases
        </h2>

        <button
          aria-label="Add connection"
          className="flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover"
          title="Add connection"
          type="button"
          onClick={handleCreateDatabase}
        >
          <Plus className="size-3" />
        </button>
      </div>

      <div className="mx-3 mb-2 flex-none">
        <SearchInput
          placeholder="Filter tables"
          value={databaseSearchQuery}
          onChange={(newValue) =>
            dispatch(databaseSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-[10px]">
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
            <p className="mt-2 px-1 text-xs text-text2">
              No matches for “{databaseSearchQuery}”.
            </p>
          ) : (
            <div className="mt-2 px-1 text-xs leading-relaxed text-text2">
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
      className={cn('relative flex-none', isDragging && 'opacity-50')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dropIndicator && (
        <DropIndicatorLine
          orientation="vertical"
          position={dropIndicator}
        />
      )}

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
        <button
          {...sortableProps}
          className="flex h-[var(--item-h)] w-full cursor-default items-center gap-[6px] rounded-[6px] px-[6px] text-left text-text2 hover:bg-hover"
          type="button"
          onClick={() => dispatch(expandDatabase(database.id))}
        >
          <ChevronRight
            className={cn(
              'size-[10px] flex-none text-text3 transition-transform duration-150',
              isExpanded ? 'rotate-90' : ''
            )}
          />

          <Database className="size-[13px] flex-none text-text3" />

          <span className="min-w-0 truncate text-[12.5px] text-text">
            {database.name}
          </span>
        </button>
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

  const handleQueryTable = useQueryTableWorksheet(database, hasMultipleSchemas)

  const tables = searchMatch?.tables ?? schema.data?.tables ?? []

  return (
    <div className="pt-[1px] pb-[3px]">
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
  onQueryTable: (table: TableInfo) => void
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
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <button
            className="flex h-[26px] w-full cursor-default items-center gap-[6px] rounded-[6px] pr-[6px] pl-5 text-left text-text2 hover:bg-hover"
            type="button"
            onClick={onToggle}
          >
            <ChevronRight
              className={cn(
                'size-[9px] flex-none text-text3 transition-transform duration-150',
                isExpanded ? 'rotate-90' : ''
              )}
            />

            <Table2Icon className="size-3 flex-none text-text3" />

            <span className="min-w-0 truncate font-mono text-xs">
              {table.tableName}
            </span>

            {hasMultipleSchemas && (
              <span className="max-w-[76px] flex-none truncate rounded-[4px] border border-border2 bg-bg px-[5px] py-[1.5px] font-mono text-[10px] text-text3">
                {table.tableSchema}
              </span>
            )}
          </button>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem
            className="flex items-center gap-2 min-w-32 text-xs"
            onClick={() => onQueryTable(table)}
          >
            <SearchIcon className="size-3" />
            Query Table
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded && (
        <div className="pt-[1px] pb-[2px]">
          {table.columns.map((column) => (
            <div
              key={`${table.tableSchema}-${table.tableName}-${column.columnName}`}
              className="flex h-[23px] items-center gap-[7px] rounded-[6px] pr-[6px] pl-[46px] text-text2 hover:bg-hover"
            >
              <span className="min-w-0 truncate font-mono text-[11.5px]">
                {column.columnName}
              </span>

              <span className="ml-auto flex-none font-mono text-[10.5px] text-text3">
                {column.dataType}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
