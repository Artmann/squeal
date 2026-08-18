import { closestCenter, DndContext } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileBracesIcon, Pencil, PlusIcon, Trash2 } from 'lucide-react'
import { ReactElement, ReactNode, useCallback } from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { useDatabases, useWorksheets } from '../hooks/queries'
import {
  useCreateWorksheet,
  useDeleteWorksheet,
  useReorderWorksheets
} from '../hooks/mutations'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
import { useReorderDrag } from '../hooks/use-reorder-drag'
import { useWorksheetRename } from '../hooks/use-worksheet-rename'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { worksheetSearchQueryUpdated } from '../store/editor-slice'
import { selectActiveWorksheetId, tabsActions } from '../store/tabs-slice'
import { getNextUntitledName } from '../worksheet-naming'
import { pickDatabaseForNewWorksheet } from '../worksheet-selection'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { DropIndicatorLine } from './DropIndicatorLine'
import { SearchInput } from './SearchInput'
import { WorksheetNameInput } from './WorksheetNameInput'
import { WorksheetDto } from '@/glue/worksheets'

// Deleting takes the editor content with it, so it asks first via an action
// toast — ignoring it is a safe no. Mirrors the database explorer.
function useConfirmedWorksheetDeletion(): (worksheet: WorksheetDto) => void {
  const deleteWorksheet = useDeleteWorksheet()

  return useCallback(
    (worksheet: WorksheetDto) => {
      toast(`Delete "${worksheet.name}"?`, {
        action: {
          label: 'Delete',
          onClick: () => {
            deleteWorksheet.mutate(worksheet.id, {
              onError: (error) => {
                const message =
                  error instanceof Error ? error.message : 'Unknown error'

                toast.error('Failed to delete worksheet', {
                  description: message
                })
              },
              onSuccess: () => {
                toast.success(`Deleted "${worksheet.name}"`)
              }
            })
          }
        },
        description:
          'This worksheet and its editor content will be removed. Query history is kept.'
      })
    },
    [deleteWorksheet]
  )
}

/**
 * What the user can do to a worksheet from the explorer: open one (which also
 * marks it most-recently-used) and create a new one. Both need the same tab
 * dispatch and touch, so they live together rather than in the component body.
 */
function useWorksheetActions(
  worksheets: WorksheetDto[],
  startEditing: (worksheet: WorksheetDto) => void
) {
  const dispatch = useAppDispatch()
  const createWorksheet = useCreateWorksheet()
  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)
  const { worksheets: worksheetsCollection } = useCollections()

  const touchWorksheet = useCallback(
    (worksheetId: string) => {
      const transaction = worksheetsCollection.update(worksheetId, (draft) => {
        draft.lastOpenedAt = Date.now()
      })

      void transaction.isPersisted.promise.catch((): void => undefined)
    },
    [worksheetsCollection]
  )

  const handleSelectWorksheet = useCallback(
    (worksheetId: string) => {
      dispatch(tabsActions.tabOpened(worksheetId))
      touchWorksheet(worksheetId)
    },
    [dispatch, touchWorksheet]
  )

  const handleNewWorksheet = useCallback(() => {
    const databaseId = pickDatabaseForNewWorksheet(
      worksheets,
      activeWorksheetId
    )
    const name = getNextUntitledName(worksheets)

    createWorksheet.mutate(
      {
        // `databaseId` is optional rather than nullable, so an unset one has to
        // be left out instead of sent as null.
        ...(databaseId === undefined ? {} : { databaseId }),
        name
      },
      {
        onSuccess: (worksheet) => {
          dispatch(tabsActions.tabOpened(worksheet.id))
          touchWorksheet(worksheet.id)
          startEditing(worksheet)
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : 'Unknown error'

          toast.error('Failed to create worksheet', { description: message })
        }
      }
    )
  }, [
    activeWorksheetId,
    createWorksheet,
    dispatch,
    startEditing,
    touchWorksheet,
    worksheets
  ])

  return { handleNewWorksheet, handleSelectWorksheet }
}

export function WorksheetExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useDatabases()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const worksheetSearchQuery = useAppSelector(
    (state) => state.editor.worksheetSearchQuery ?? ''
  )

  const {
    editingName,
    editingWorksheetId,
    handleKeyDown,
    handleRenameSubmit,
    inputRef,
    setEditingName,
    startEditing
  } = useWorksheetRename(worksheets.data, 'explorer')

  const { handleNewWorksheet, handleSelectWorksheet } = useWorksheetActions(
    worksheets.data,
    startEditing
  )

  const handleDeleteWorksheet = useConfirmedWorksheetDeletion()

  // The list order comes from the useWorksheets live query (sortOrder, then
  // newest first).
  const filteredWorksheets = worksheets.data.filter((worksheet) =>
    worksheet.name.toLowerCase().includes(worksheetSearchQuery.toLowerCase())
  )

  // Reordering a filtered subset is ambiguous, so dragging only works on the
  // full list.
  const isSortingDisabled = worksheetSearchQuery.length > 0
  const reorderWorksheets = useReorderWorksheets()

  const filteredWorksheetIds = filteredWorksheets.map(
    (worksheet) => worksheet.id
  )
  const {
    dropIndicatorFor,
    handleDragOver,
    handleDragStart,
    resetDropIndicator
  } = useDropIndicator(filteredWorksheetIds)

  const { handleDragEnd, sensors } = useReorderDrag({
    ids: worksheets.data.map((worksheet) => worksheet.id),
    onReorder: reorderWorksheets.mutate,
    resetDropIndicator
  })

  // Worksheets show which database they run against, so the names are looked
  // up once per render instead of per row.
  const databaseNames = new Map(
    databases.data.map((database) => [database.id, database.name])
  )

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-none items-center justify-between pt-[14px] pr-3 pb-2 pl-4">
        <h2 className="text-[11px] font-semibold tracking-[0.08em] text-text3 uppercase">
          Worksheets
        </h2>

        <button
          aria-label="New worksheet"
          className="flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover"
          title="New worksheet"
          type="button"
          onClick={handleNewWorksheet}
        >
          <PlusIcon className="size-3" />
        </button>
      </div>

      <div className="mx-3 mb-2 flex-none">
        <SearchInput
          placeholder="Filter worksheets"
          value={worksheetSearchQuery}
          onChange={(newValue) =>
            dispatch(worksheetSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex min-h-0 flex-col gap-[1px] overflow-y-auto px-2 pb-2">
        {filteredWorksheets.length === 0 && (
          <p className="mt-1 px-1 text-xs leading-relaxed text-text2">
            Worksheets are where you write and save SQL.{' '}
            <button
              className="underline underline-offset-2 hover:text-text transition-colors"
              onClick={handleNewWorksheet}
              type="button"
            >
              Create your first one
            </button>
            .
          </p>
        )}

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
            items={filteredWorksheetIds}
            strategy={staticListStrategy}
          >
            {filteredWorksheets.map((worksheet, index) => (
              <WorksheetRow
                key={worksheet.id}
                dropIndicator={dropIndicatorFor(index)}
                isSortingDisabled={
                  isSortingDisabled || editingWorksheetId === worksheet.id
                }
                worksheetId={worksheet.id}
              >
                {editingWorksheetId === worksheet.id ? (
                  <WorksheetRenameInput
                    editingName={editingName}
                    inputRef={inputRef}
                    worksheetId={worksheet.id}
                    worksheetName={worksheet.name}
                    onEditingNameChange={setEditingName}
                    onKeyDown={handleKeyDown}
                    onRenameSubmit={handleRenameSubmit}
                  />
                ) : (
                  <WorksheetListItem
                    canDelete={worksheets.data.length > 1}
                    databaseName={
                      worksheet.databaseId
                        ? databaseNames.get(worksheet.databaseId)
                        : undefined
                    }
                    isOpen={worksheet.id === openWorksheetId}
                    worksheet={worksheet}
                    onDelete={handleDeleteWorksheet}
                    onDoubleClick={startEditing}
                    onSelect={handleSelectWorksheet}
                  />
                )}
              </WorksheetRow>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

interface WorksheetRowProps {
  children: ReactNode
  dropIndicator: DropIndicator
  isSortingDisabled: boolean
  worksheetId: string
}

// The whole row is the drag handle. While the row is being renamed its
// sortable is disabled, so selecting text in the input never starts a drag.
// The keyboard-sortable attributes are skipped on purpose — only the pointer
// sensor is wired, and a focusable wrapper would double up the button's tab
// stop.
function WorksheetRow({
  children,
  dropIndicator,
  isSortingDisabled,
  worksheetId
}: WorksheetRowProps): ReactElement {
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({ disabled: isSortingDisabled, id: worksheetId })

  return (
    <div
      ref={setNodeRef}
      className={cn('relative flex-none', isDragging && 'opacity-50')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(isSortingDisabled ? {} : listeners)}
    >
      {dropIndicator && (
        <DropIndicatorLine
          orientation="vertical"
          position={dropIndicator}
        />
      )}

      {children}
    </div>
  )
}

interface WorksheetListItemProps {
  // False for the last remaining worksheet: the app is built around always
  // having one open, and the list endpoint would just recreate a default.
  canDelete: boolean
  databaseName?: string
  isOpen: boolean
  worksheet: WorksheetDto
  onDelete: (worksheet: WorksheetDto) => void
  onDoubleClick: (worksheet: WorksheetDto) => void
  onSelect: (worksheetId: string) => void
}

function WorksheetListItem({
  canDelete,
  databaseName,
  isOpen,
  worksheet,
  onDelete,
  onDoubleClick,
  onSelect
}: WorksheetListItemProps): ReactElement {
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          className={cn(
            'flex h-[var(--item-h)] w-full flex-none items-center gap-2 rounded-[6px] px-2 text-left hover:bg-hover',
            isOpen ? 'bg-sel text-text' : 'text-text2'
          )}
          type="button"
          onClick={() => onSelect(worksheet.id)}
          onDoubleClick={() => onDoubleClick(worksheet)}
        >
          <FileBracesIcon
            className={cn(
              'size-[13px] flex-none',
              isOpen ? 'text-accent' : 'text-text3'
            )}
          />

          <span className="min-w-0 flex-1 truncate text-[12.5px]">
            {worksheet.name}
          </span>

          {databaseName !== undefined && (
            <span className="max-w-[76px] flex-none truncate rounded-[4px] border border-border2 bg-bg px-[5px] py-[1.5px] font-mono text-[10px] text-text3">
              {databaseName}
            </span>
          )}
        </button>
      </ContextMenuTrigger>

      <ContextMenuContent
        // Radix hands focus back to the trigger when the menu closes. That
        // blurs the input Rename just opened, and a blur commits the edit, so
        // the rename would end before a single key was pressed.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs"
          onClick={() => onDoubleClick(worksheet)}
        >
          <Pencil className="size-3" />
          Rename
        </ContextMenuItem>

        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs text-destructive focus:text-destructive"
          disabled={!canDelete}
          onClick={() => onDelete(worksheet)}
        >
          <Trash2 className="size-3" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface WorksheetRenameInputProps {
  editingName: string
  inputRef: React.RefObject<HTMLInputElement | null>
  worksheetId: string
  worksheetName: string
  onEditingNameChange: (name: string) => void
  onKeyDown: (event: React.KeyboardEvent, worksheetId: string) => void
  onRenameSubmit: (worksheetId: string) => void
}

// Keeps the row's icon and height while the name is being edited, so the list
// does not shift under the cursor.
function WorksheetRenameInput({
  editingName,
  inputRef,
  worksheetId,
  worksheetName,
  onEditingNameChange,
  onKeyDown,
  onRenameSubmit
}: WorksheetRenameInputProps): ReactElement {
  return (
    <div className="flex h-[var(--item-h)] items-center gap-2 px-2">
      <FileBracesIcon className="size-[13px] flex-none text-text3" />

      <WorksheetNameInput
        ariaLabel={`Rename ${worksheetName}`}
        editingName={editingName}
        inputRef={inputRef}
        worksheetId={worksheetId}
        onEditingNameChange={onEditingNameChange}
        onKeyDown={onKeyDown}
        onRenameSubmit={onRenameSubmit}
      />
    </div>
  )
}
