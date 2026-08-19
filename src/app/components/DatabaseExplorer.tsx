import { DndContext } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ChevronRight,
  Database,
  Pencil,
  Plus,
  RefreshCwIcon,
  SearchIcon,
  Table2Icon,
  Trash2,
  TriangleAlertIcon
} from 'lucide-react'
import { ReactElement, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { useDatabases, useDatabaseSchemas } from '../hooks/queries'
import {
  useCreateWorksheet,
  useDeleteDatabase,
  useRefreshDatabases,
  useReorderDatabases
} from '../hooks/mutations'
import { getRefreshShortcut } from '../refresh-shortcut'
import {
  staticListStrategy,
  useListReorder,
  type DropIndicator
} from '../hooks/use-list-reorder'
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
import { DatabaseDto, isConnectionUnreadable } from '@/glue/databases'
import { secretStorageMessages } from '@/glue/secret-storage'
import { DropIndicatorLine } from './DropIndicatorLine'

interface RenderedDatabaseRow {
  database: DatabaseDto
  hasMultipleSchemas: boolean
  /** The row's stored secret could not be read, so there is nothing to browse. */
  isUnreadable: boolean
  /** Why this database's schema could not be loaded, if it could not. */
  schemaError?: string
  searchMatch?: DatabaseMatch
  tables: TableInfo[]
}

// Only what this module needs from a schema query, so the row builder stays a
// pure function the tests can call directly.
interface SchemaResult {
  data: SchemaInfo | undefined
  error: Error | null
}

// Builds the rows to render: while searching, only databases with a match
// (and their matching tables) survive; otherwise every database is shown.
// Each row notes whether its database spans multiple schemas, so duplicate
// table names (common across schemas) stay distinguishable without adding
// noise to single-schema databases.
//
// This is the only place holding both the schema and the match, so it is the
// only place that decides what a row shows. That matters because
// `DatabaseMatch.tables` means two things — the matching subset when the
// search forces the row open, the whole list when only the name matched — and
// resolving it here is what lets the list component take a plain array of
// tables. `DatabaseRow` is still handed the match, but only to decide whether
// the row is open.
//
// A row also carries why it has no tables when it has none. Both reasons look
// identical in a tree — an empty subtree — and neither is: one needs the
// password re-entered, the other names a server that did not answer.
function computeRenderedRows(
  databases: DatabaseDto[],
  schemaResults: (SchemaResult | undefined)[],
  searchQuery: string
): RenderedDatabaseRow[] {
  const isSearching = searchQuery.trim().length > 0

  const rows = databases.map((database, index) => {
    const schema = schemaResults[index]?.data

    const searchMatch = isSearching
      ? (computeDatabaseMatch(database, schema, searchQuery) ?? undefined)
      : undefined

    return {
      database,
      hasMultipleSchemas: spansMultipleSchemas(schema),
      isUnreadable: isConnectionUnreadable(database),
      schemaError: schemaResults[index]?.error?.message,
      searchMatch,
      // Reading the schema here rather than in the expanded row gives up no
      // laziness: the caller fetches every schema unconditionally. If a
      // conditional prefetch is ever reintroduced, the tables have to be
      // threaded from wherever that fetch lands instead of being read again
      // further down.
      tables: searchMatch?.tables ?? schema?.tables ?? []
    }
  })

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

interface DatabaseTreeRefresh {
  isRefreshing: boolean
  refresh: (database: DatabaseDto) => void
  refreshAll: () => void
}

// A refresh is the user asking to see the truth, so a failure has to say so
// rather than leaving the stale tree in place looking current. The backend's
// SchemaLoadFailedError already names the database and the reason — "Failed to
// load schema for "Pagila": connection refused" — so the description carries
// it. With several connections failing at once the first error speaks for all
// of them; the ones that answered are updated either way.
//
// The shortcut lives here rather than in the component because it is the same
// concern: refresh everything, from wherever the user is. Enabled on form tags
// and content-editables so it still fires with focus in the filter input or the
// SQL editor.
function useRefreshDatabaseTree(): DatabaseTreeRefresh {
  const refreshDatabases = useRefreshDatabases()

  const refresh = useCallback(
    (database?: DatabaseDto) => {
      refreshDatabases.mutate(
        { databaseId: database?.id },
        {
          onError: (error) => {
            const message =
              error instanceof Error ? error.message : 'Unknown error'

            toast.error(
              database
                ? `Failed to refresh "${database.name}"`
                : 'Failed to refresh databases',
              { description: message }
            )
          }
        }
      )
    },
    [refreshDatabases]
  )

  const refreshAll = useCallback(() => {
    refresh()
  }, [refresh])

  useHotkeys('mod+alt+r', refreshAll, {
    enableOnContentEditable: true,
    enableOnFormTags: true,
    preventDefault: true
  })

  return { isRefreshing: refreshDatabases.isPending, refresh, refreshAll }
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
  // and reuse those results as the source for what each row shows, matched or
  // not.
  //
  // A database whose secret cannot be read is asked for nothing: the request
  // would fail for a reason already known from the list, and with retries it
  // fails several times per row on every launch.
  const schemaResults = useDatabaseSchemas(
    databases.data.map((database) => ({
      databaseId: database.id,
      isEnabled: !isConnectionUnreadable(database)
    }))
  )

  const renderedRows = computeRenderedRows(
    databases.data,
    schemaResults,
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
  // The reorder runs over the whole list; the rows a search has left on screen
  // are a subsequence of it, and asking for the indicator by id is what lets
  // those two lists differ without any index having to line up.
  const { dndContextProps, dropIndicatorFor } = useListReorder({
    axis: 'vertical',
    ids: databases.data.map((database) => database.id),
    onReorder: reorderDatabases.mutate
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

  const { isRefreshing, refresh, refreshAll } = useRefreshDatabaseTree()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DatabaseExplorerHeader
        hasDatabases={databases.data.length > 0}
        isRefreshing={isRefreshing}
        onCreate={handleCreateDatabase}
        onRefresh={refreshAll}
      />

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
        <DndContext {...dndContextProps}>
          <SortableContext
            items={renderedDatabaseIds}
            strategy={staticListStrategy}
          >
            {renderedRows.map((row) => (
              <DatabaseRow
                key={row.database.id}
                database={row.database}
                dropIndicator={dropIndicatorFor(row.database.id)}
                expansion={expandedDatabases[row.database.id]}
                hasMultipleSchemas={row.hasMultipleSchemas}
                isSortingDisabled={isSortingDisabled}
                isUnreadable={row.isUnreadable}
                schemaError={row.schemaError}
                searchMatch={row.searchMatch}
                searchQuery={normalizedSearchQuery}
                tables={row.tables}
                onDelete={handleDeleteDatabase}
                onEdit={handleEditDatabase}
                onRefresh={refresh}
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

interface DatabaseExplorerHeaderProps {
  hasDatabases: boolean
  isRefreshing: boolean
  onCreate: () => void
  onRefresh: () => void
}

function DatabaseExplorerHeader({
  hasDatabases,
  isRefreshing,
  onCreate,
  onRefresh
}: DatabaseExplorerHeaderProps): ReactElement {
  return (
    <div className="flex flex-none items-center justify-between pt-[10px] pr-3 pb-2 pl-4">
      <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text3 uppercase">
        Databases
      </h2>

      <div className="flex flex-none items-center gap-[2px]">
        {/* Nothing to reload without a connection, and the empty state below
            already carries its own call to action. */}
        {hasDatabases && (
          <button
            aria-label="Refresh databases"
            className="flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover disabled:opacity-50"
            disabled={isRefreshing}
            title={`Refresh databases (${getRefreshShortcut()})`}
            type="button"
            onClick={onRefresh}
          >
            <RefreshCwIcon
              className={cn('size-3', isRefreshing && 'animate-spin')}
            />
          </button>
        )}

        <button
          aria-label="Add connection"
          className="flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover"
          title="Add connection"
          type="button"
          onClick={onCreate}
        >
          <Plus className="size-3" />
        </button>
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
  isUnreadable: boolean
  onDelete: (database: DatabaseDto) => void
  onEdit: (databaseId: string) => void
  onRefresh: (database: DatabaseDto) => void
  schemaError?: string
  /** Only for deciding whether the row is open — what it shows is `tables`. */
  searchMatch?: DatabaseMatch
  /** Normalized, so trailing whitespace does not count as a new question. */
  searchQuery: string
  tables: TableInfo[]
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

interface RowActivationOptions {
  databaseId: string
  isExpanded: boolean
  isUnreadable: boolean
  onEdit: (databaseId: string) => void
  searchQuery: string
}

// What clicking a row does.
//
// Expanding is stamped with the query it answers, and derived from the resolved
// state — what the user is actually looking at — so the write always matches
// what they just clicked.
//
// An unreadable row has no tree to open, so its click goes where the only useful
// action is: the form that repairs it. Toggling instead would answer a click
// with nothing happening.
function useRowActivation({
  databaseId,
  isExpanded,
  isUnreadable,
  onEdit,
  searchQuery
}: RowActivationOptions): () => void {
  const dispatch = useAppDispatch()

  return useCallback(() => {
    if (isUnreadable) {
      onEdit(databaseId)

      return
    }

    dispatch(
      setDatabaseExpanded({
        databaseId,
        isExpanded: !isExpanded,
        query: searchQuery
      })
    )
  }, [databaseId, dispatch, isExpanded, isUnreadable, onEdit, searchQuery])
}

function DatabaseRow({
  database,
  dropIndicator,
  expansion,
  hasMultipleSchemas,
  isSortingDisabled,
  isUnreadable,
  onDelete,
  onEdit,
  onRefresh,
  schemaError,
  searchMatch,
  searchQuery,
  tables
}: DatabaseRowProps): ReactElement {
  const isDatabaseExpanded =
    !isUnreadable && isRowExpanded(expansion, searchMatch, searchQuery)

  const handleActivate = useRowActivation({
    databaseId: database.id,
    isExpanded: isDatabaseExpanded,
    isUnreadable,
    searchQuery,
    onEdit
  })

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
        isUnreadable={isUnreadable}
        schemaError={schemaError}
        // While filtering only dragging is off, so skip the sortable props
        // entirely — spreading them would mark the row aria-disabled even
        // though clicking still works.
        sortableProps={isSortingDisabled ? {} : { ...attributes, ...listeners }}
        onActivate={handleActivate}
        onDelete={onDelete}
        onEdit={onEdit}
        onRefresh={onRefresh}
      />

      {isDatabaseExpanded && (
        <DatabaseRowBody
          database={database}
          hasMultipleSchemas={hasMultipleSchemas}
          schemaError={schemaError}
          tables={tables}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}

interface DatabaseRowBodyProps {
  database: DatabaseDto
  hasMultipleSchemas: boolean
  onRefresh: (database: DatabaseDto) => void
  schemaError?: string
  tables: TableInfo[]
}

// What an open row holds: its tables, or why they are missing.
function DatabaseRowBody({
  database,
  hasMultipleSchemas,
  onRefresh,
  schemaError,
  tables
}: DatabaseRowBodyProps): ReactElement {
  if (schemaError !== undefined) {
    return (
      <DatabaseRowNotice
        actionLabel="Retry"
        message={schemaError}
        onAction={() => onRefresh(database)}
      />
    )
  }

  return (
    <DatabaseTableList
      database={database}
      hasMultipleSchemas={hasMultipleSchemas}
      tables={tables}
    />
  )
}

interface DatabaseRowNoticeProps {
  actionLabel: string
  message: string
  onAction: () => void
}

// Why an expanded row has no tables, in the place the tables would have been,
// with the one action that changes it — rather than an empty subtree that looks
// like a database with nothing in it. Only reached for a row the user opened, so
// the sentence is never repeated down the whole list.
function DatabaseRowNotice({
  actionLabel,
  message,
  onAction
}: DatabaseRowNoticeProps): ReactElement {
  return (
    <div className="pt-[1px] pr-[6px] pb-[3px] pl-[26px]">
      <p className="text-[11.5px] leading-relaxed text-text2">{message}</p>

      <button
        className="text-[11.5px] text-accent hover:underline"
        type="button"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  )
}

interface RowWarningIconProps {
  className?: string
  label: string
}

// The accessible name and the tooltip both live on the wrapper rather than on
// the SVG: `title` is an HTML attribute, and browsers do not treat it as one
// when it lands on an svg element.
function RowWarningIcon({
  className,
  label
}: RowWarningIconProps): ReactElement {
  return (
    <span
      aria-label={label}
      className={cn('flex flex-none items-center', className)}
      role="img"
      title={label}
    >
      <TriangleAlertIcon
        aria-hidden
        className="size-[10px] text-err"
      />
    </span>
  )
}

interface DatabaseRowHeaderProps {
  database: DatabaseDto
  isExpanded: boolean
  isUnreadable: boolean
  onActivate: () => void
  onDelete: (database: DatabaseDto) => void
  onEdit: (databaseId: string) => void
  onRefresh: (database: DatabaseDto) => void
  schemaError?: string
  sortableProps: Record<string, unknown>
}

function DatabaseRowHeader({
  database,
  isExpanded,
  isUnreadable,
  onActivate,
  onDelete,
  onEdit,
  onRefresh,
  schemaError,
  sortableProps
}: DatabaseRowHeaderProps): ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          {...sortableProps}
          // Nothing expands, so the row does not claim to: aria-expanded on a
          // control that opens nothing tells a screen reader to wait for a
          // subtree that never arrives.
          aria-expanded={isUnreadable ? undefined : isExpanded}
          className="flex h-[var(--item-h)] w-full cursor-default items-center gap-[6px] rounded-[6px] px-[6px] text-left text-text2 hover:bg-hover"
          type="button"
          onClick={onActivate}
        >
          {isUnreadable ? (
            <RowWarningIcon
              label={secretStorageMessages.unreadableConnection}
            />
          ) : (
            <ChevronRight
              className={cn(
                'size-[10px] flex-none text-text3 transition-transform duration-150',
                isExpanded ? 'rotate-90' : ''
              )}
            />
          )}

          <Database className="size-[13px] flex-none text-text3" />

          <span className="min-w-0 truncate text-[12.5px] text-text">
            {database.name}
          </span>

          {/* The whole row already opens the repair form, so this is a label
              rather than a control — a button inside a button. Kept to one line
              and one short phrase: with several broken connections, a sentence
              per row buries the list it is describing, and the marker's tooltip
              is where the full explanation lives. */}
          {isUnreadable && (
            <span className="ml-auto flex-none text-[11px] text-accent">
              Re-enter details
            </span>
          )}

          {/* A readable connection whose schema would not load keeps its
              chevron — there is still a subtree, carrying the reason. */}
          {schemaError !== undefined && (
            <RowWarningIcon
              className="ml-auto"
              label={schemaError}
            />
          )}
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs"
          onClick={() => onRefresh(database)}
        >
          <RefreshCwIcon className="size-3" />
          Refresh
        </ContextMenuItem>

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
  tables: TableInfo[]
}

function DatabaseTableList({
  database,
  hasMultipleSchemas,
  tables
}: DatabaseTableListProps): ReactElement {
  const dispatch = useAppDispatch()
  const expandedTables = useAppSelector(
    (state) => state.databaseExplorer.expandedTables
  )

  const handleQueryTable = useQueryTableWorksheet(database, hasMultipleSchemas)

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
