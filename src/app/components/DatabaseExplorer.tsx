import {
  closestCenter,
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { arrayMove, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import {
  useDatabases,
  useDatabaseSchema,
  useDatabaseSchemas
} from '../hooks/queries'
import { useCreateWorksheet, useReorderDatabases } from '../hooks/mutations'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
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
import { DatabaseDto } from '@/glue/databases'
import { DropIndicatorLine } from './DropIndicatorLine'

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

  const searchMatches = isSearching
    ? databases.data
        .map((database, index) =>
          computeDatabaseMatch(
            database,
            schemaResults[index]?.data,
            databaseSearchQuery
          )
        )
        .filter((match): match is DatabaseMatch => match !== null)
    : null

  // A table row shows its schema only when its database spans more than one, so
  // duplicate table names (common across schemas) stay distinguishable without
  // adding noise to single-schema databases.
  const multipleSchemasByDatabaseId = new Map<string, boolean>()
  databases.data.forEach((database, index) => {
    const schemaTables = schemaResults[index]?.data?.tables ?? []
    const schemaNames = new Set(schemaTables.map((table) => table.tableSchema))

    multipleSchemasByDatabaseId.set(database.id, schemaNames.size > 1)
  })

  const baseRows = searchMatches
    ? searchMatches.map((match) => ({
        database: match.database,
        searchMatch: match
      }))
    : databases.data.map((database) => ({ database }))

  const renderedRows: RenderedDatabaseRow[] = baseRows.map((row) => ({
    ...row,
    hasMultipleSchemas: multipleSchemasByDatabaseId.get(row.database.id) ?? false
  }))

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      resetDropIndicator()

      if (!over || active.id === over.id) {
        return
      }

      const databaseIds = databases.data.map((database) => database.id)
      const orderedIds = arrayMove(
        databaseIds,
        databaseIds.indexOf(String(active.id)),
        databaseIds.indexOf(String(over.id))
      )

      reorderDatabases.mutate(orderedIds)
    },
    [databases.data, reorderDatabases, resetDropIndicator]
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

interface RenderedDatabaseRow {
  database: DatabaseDto
  hasMultipleSchemas: boolean
  searchMatch?: DatabaseMatch
}

interface DatabaseRowProps {
  database: DatabaseDto
  dropIndicator: DropIndicator
  hasMultipleSchemas: boolean
  isExpanded: boolean
  isSortingDisabled: boolean
  onEdit: (databaseId: string) => void
  searchMatch?: DatabaseMatch
}

function DatabaseRow({
  database,
  dropIndicator,
  hasMultipleSchemas,
  isExpanded,
  isSortingDisabled,
  onEdit,
  searchMatch
}: DatabaseRowProps): ReactElement {
  const dispatch = useAppDispatch()
  const expandedTables = useAppSelector(
    (state) => state.databaseExplorer.expandedTables
  )

  // While searching, the tables come from the precomputed match and the row is
  // forced open to reveal them, so the lazy per-row fetch is skipped.
  const schema = useDatabaseSchema(
    searchMatch ? undefined : isExpanded ? database.id : undefined
  )

  const isDatabaseExpanded = searchMatch
    ? searchMatch.expandDatabase || isExpanded
    : isExpanded

  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ disabled: isSortingDisabled, id: database.id })

  const createWorksheet = useCreateWorksheet()
  const { worksheets: worksheetsCollection } = useCollections()

  const tableEntries = searchMatch
    ? searchMatch.tables
    : schema.data?.tables ?? []

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
    // The transform lives on the wrapper so an expanded subtree moves with the
    // row, while only the row button acts as the drag handle.
    <div
      ref={setNodeRef}
      className={cn('relative', isDragging && 'opacity-50')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {dropIndicator && <DropIndicatorLine position={dropIndicator} />}

      <ContextMenu>
        <ContextMenuTrigger>
          <Button
            // While filtering only dragging is off, so skip the sortable
            // props entirely — spreading them would mark the row
            // aria-disabled even though clicking still works.
            {...(isSortingDisabled ? {} : { ...attributes, ...listeners })}
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
            onClick={() => onEdit(database.id)}
          >
            <Pencil className="size-3" />
            Edit
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isDatabaseExpanded && (
        <div className="flex flex-col gap-0.5 pl-4 pt-1">
          {tableEntries.map((table) => {
            // Table names repeat across schemas, so the key must include the
            // schema — otherwise same-named tables collide and expanding one
            // toggles them all.
            const tableKey = `${database.id}-${table.tableSchema}-${table.tableName}`
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
