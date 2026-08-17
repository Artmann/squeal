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
import {
  DatabaseExpansion,
  expandTable,
  setDatabaseExpanded
} from '../store/database-explorer-slice'
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

  // Normalized the way `computeDatabaseMatch` normalizes, because it is what
  // an expansion is scoped to: a decision answers the question the user asked,
  // so adding a trailing space must not count as asking a new one.
  const normalizedSearchQuery = databaseSearchQuery.trim().toLowerCase()

  const isSearching = normalizedSearchQuery.length > 0

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
                expansion={expandedDatabases[row.database.id]}
                hasMultipleSchemas={row.hasMultipleSchemas}
                isSortingDisabled={isSortingDisabled}
                searchMatch={row.searchMatch}
                searchQuery={normalizedSearchQuery}
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
  /** The user's own decision, or `undefined` if they have never made one. */
  expansion: DatabaseExpansion | undefined
  hasMultipleSchemas: boolean
  isSortingDisabled: boolean
  onDelete: (database: DatabaseDto) => void
  onEdit: (databaseId: string) => void
  searchMatch?: DatabaseMatch
  /** Normalized, so trailing whitespace does not count as a new question. */
  searchQuery: string
}

// A decision only speaks for the context it was made in:
//
//   not searching                       → their decision, absent → collapsed
//   decided under *this* query          → what they decided
//   stale decision, table match         → open: the match wins
//   stale decision, name-only match     → their decision
//
// The two search outcomes are deliberately not symmetric, because the search's
// two proposals are not the same kind of thing. `expandDatabase: true` is an
// active instruction — reveal these matching tables — so it has to beat a
// stale decision: otherwise one collapse made while browsing would veto every
// later search for that database, leaving the row listed as a match with its
// matches missing, and silently, because the filter still looks like it ran.
// `expandDatabase: false` is not an instruction at all, only the absence of
// one — the query matched the database's name and said nothing about its
// tables — so it has nothing to say against a row the user opened themselves.
// Merging the two with `||` instead — the original bug — made a click on a
// forced-open row unrepresentable: it flipped a bit nothing read, so it moved
// nothing.
function isRowExpanded(
  expansion: DatabaseExpansion | undefined,
  searchMatch: DatabaseMatch | undefined,
  searchQuery: string
): boolean {
  const expandedByUser = expansion?.isExpanded ?? false

  // No test can tell this branch from the fall-through below, because callers
  // pass no match while not searching, and that path lands on the same value.
  // It stays because it makes the rule true here rather than true by a
  // caller's habit: if a match ever outlived its query, the fall-through would
  // start consulting a proposal for a search that is no longer running.
  if (searchQuery.length === 0) {
    return expandedByUser
  }

  if (expansion?.query === searchQuery) {
    return expandedByUser
  }

  return searchMatch?.expandDatabase === true ? true : expandedByUser
}

function DatabaseRow({
  database,
  dropIndicator,
  expansion,
  hasMultipleSchemas,
  isSortingDisabled,
  onDelete,
  onEdit,
  searchMatch,
  searchQuery
}: DatabaseRowProps): ReactElement {
  const dispatch = useAppDispatch()

  const isDatabaseExpanded = isRowExpanded(expansion, searchMatch, searchQuery)

  // Stamped with the query it answers, and derived from the resolved state —
  // what the user is actually looking at — so the write always matches what
  // they just clicked.
  const handleToggle = useCallback(() => {
    dispatch(
      setDatabaseExpanded({
        databaseId: database.id,
        isExpanded: !isDatabaseExpanded,
        query: searchQuery
      })
    )
  }, [database.id, dispatch, isDatabaseExpanded, searchQuery])

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
        onToggle={handleToggle}
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
  onToggle: () => void
  sortableProps: Record<string, unknown>
}

function DatabaseRowHeader({
  database,
  isExpanded,
  onDelete,
  onEdit,
  onToggle,
  sortableProps
}: DatabaseRowHeaderProps): ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          {...sortableProps}
          aria-expanded={isExpanded}
          className="flex h-[var(--item-h)] w-full cursor-default items-center gap-[6px] rounded-[6px] px-[6px] text-left text-text2 hover:bg-hover"
          type="button"
          onClick={onToggle}
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
            aria-expanded={isExpanded}
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
