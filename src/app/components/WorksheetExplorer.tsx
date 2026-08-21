import { DndContext } from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileBracesIcon, Pencil, PlusIcon, Trash2 } from 'lucide-react'
import { ReactElement, ReactNode, useCallback } from 'react'
import { toast } from 'sonner'

import { useDatabases, useWorksheets } from '../hooks/queries'
import { useDeleteWorksheet, useReorderWorksheets } from '../hooks/mutations'
import {
  staticListStrategy,
  useListReorder,
  type DropIndicator
} from '../hooks/use-list-reorder'
import {
  useCreateAndOpenWorksheet,
  useOpenWorksheet
} from '../hooks/use-worksheet-commands'
import { useWorksheetRename } from '../hooks/use-worksheet-rename'
import { useWorksheetSelection } from '../hooks/use-worksheet-selection'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { worksheetSearchQueryUpdated } from '../store/editor-slice'
import { selectActiveWorksheetId } from '../store/tabs-slice'
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

// One worksheet is named; several are counted. The count is what makes a
// multi-row delete safe to confirm — "Delete 3 worksheets?" is the only place
// the user learns the menu meant more than the row they right-clicked.
function describeWorksheets(worksheets: WorksheetDto[]): string {
  return worksheets.length === 1
    ? `"${worksheets[0].name}"`
    : `${worksheets.length} worksheets`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

// Deleting takes the editor content with it, so it asks first via an action
// toast — ignoring it is a safe no. Mirrors the database explorer.
function useConfirmedWorksheetDeletion(): (worksheets: WorksheetDto[]) => void {
  const deleteWorksheet = useDeleteWorksheet()

  return useCallback(
    (worksheets: WorksheetDto[]) => {
      if (worksheets.length === 0) {
        return
      }

      const described = describeWorksheets(worksheets)

      toast(`Delete ${described}?`, {
        action: {
          label: 'Delete',
          onClick: () => {
            // `allSettled`, so one row that will not go does not strand the
            // others: every delete is attempted and the toast afterwards says
            // how many made it. The selection needs no clearing — it is pruned
            // to the rows that still exist on the next render.
            const deletions = Promise.allSettled(
              worksheets.map((worksheet) =>
                deleteWorksheet.mutateAsync(worksheet.id)
              )
            )

            void deletions.then((results) => {
              const failures = results.filter(
                (result) => result.status === 'rejected'
              )

              if (failures.length === 0) {
                toast.success(`Deleted ${described}`)

                return
              }

              const description = errorMessage(failures[0].reason)

              if (worksheets.length === 1) {
                toast.error('Failed to delete worksheet', { description })

                return
              }

              toast.error(
                `Failed to delete ${failures.length} of ${worksheets.length} worksheets`,
                { description }
              )
            })
          }
        },
        description:
          worksheets.length === 1
            ? 'This worksheet and its editor content will be removed. Query history is kept.'
            : 'These worksheets and their editor content will be removed. Query history is kept.'
      })
    },
    [deleteWorksheet]
  )
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

  const handleNewWorksheet = useCreateAndOpenWorksheet({
    onCreated: startEditing
  })
  const handleSelectWorksheet = useOpenWorksheet()

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
  const worksheetIds = worksheets.data.map((worksheet) => worksheet.id)

  const selection = useWorksheetSelection(worksheetIds)

  // The reorder runs over the whole list; the filtered rows on screen are a
  // subsequence of it, and asking for the indicator by id is what lets those
  // two lists differ without any index having to line up.
  const { dndContextProps, dropIndicatorFor, isMoving } = useListReorder({
    axis: 'vertical',
    ids: worksheetIds,
    onReorder: reorderWorksheets.mutate,
    selectedIds: selection.ids
  })

  // Command- and shift-click pick rows out; a plain click is still what opens
  // one. Modified clicks deliberately leave the open worksheet where it is —
  // picking rows out to move them should not swap the editor under the user.
  const handleRowClick = (
    event: React.MouseEvent,
    worksheetId: string
  ): void => {
    // ⌘ on macOS, Ctrl everywhere else.
    if (event.metaKey || event.ctrlKey) {
      selection.toggle(worksheetId)

      return
    }

    if (event.shiftKey) {
      selection.extend(worksheetId)

      return
    }

    selection.replace(worksheetId)
    handleSelectWorksheet(worksheetId)
  }

  // Right-clicking outside the selection makes that row the selection, the way
  // a file manager does, so the menu can never act on rows the user is not
  // pointing at.
  const handleRowContextMenu = (worksheetId: string): void => {
    if (!selection.isSelected(worksheetId)) {
      selection.replace(worksheetId)
    }
  }

  const selectedWorksheets = worksheets.data.filter((worksheet) =>
    selection.isSelected(worksheet.id)
  )

  // A row inside a multi-row selection opens a menu about the whole selection;
  // anything else is about itself, including the single row a selection has
  // shrunk to.
  const deleteTargetsFor = (worksheet: WorksheetDto): WorksheetDto[] =>
    selectedWorksheets.length > 1 && selection.isSelected(worksheet.id)
      ? selectedWorksheets
      : [worksheet]

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

        <DndContext {...dndContextProps}>
          <SortableContext
            items={filteredWorksheetIds}
            strategy={staticListStrategy}
          >
            {filteredWorksheets.map((worksheet) => (
              <WorksheetRow
                key={worksheet.id}
                dropIndicator={dropIndicatorFor(worksheet.id)}
                isMoving={isMoving(worksheet.id)}
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
                    databaseName={
                      worksheet.databaseId
                        ? databaseNames.get(worksheet.databaseId)
                        : undefined
                    }
                    deleteTargets={deleteTargetsFor(worksheet)}
                    isOpen={worksheet.id === openWorksheetId}
                    isSelected={selection.isSelected(worksheet.id)}
                    remainingWorksheetCount={worksheets.data.length}
                    worksheet={worksheet}
                    onContextMenu={handleRowContextMenu}
                    onDelete={handleDeleteWorksheet}
                    onDoubleClick={startEditing}
                    onSelect={handleRowClick}
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
  /**
   * Whether this row is travelling with the drag. Not `useSortable`'s
   * `isDragging`, which only knows about the row under the cursor: a selection
   * dragged as a group carries rows the cursor never touched, and dimming all
   * of them is the only thing that says what is being carried.
   */
  isMoving: boolean
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
  isMoving,
  isSortingDisabled,
  worksheetId
}: WorksheetRowProps): ReactElement {
  const { listeners, setNodeRef, transform, transition } = useSortable({
    disabled: isSortingDisabled,
    id: worksheetId
  })

  return (
    <div
      ref={setNodeRef}
      className={cn('relative flex-none', isMoving && 'opacity-50')}
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
  databaseName?: string
  /** What this row's menu acts on: itself, or the selection it belongs to. */
  deleteTargets: WorksheetDto[]
  isOpen: boolean
  isSelected: boolean
  /** How many worksheets there are, which is what caps a delete. */
  remainingWorksheetCount: number
  worksheet: WorksheetDto
  onContextMenu: (worksheetId: string) => void
  onDelete: (worksheets: WorksheetDto[]) => void
  onDoubleClick: (worksheet: WorksheetDto) => void
  onSelect: (event: React.MouseEvent, worksheetId: string) => void
}

function WorksheetListItem({
  databaseName,
  deleteTargets,
  isOpen,
  isSelected,
  remainingWorksheetCount,
  worksheet,
  onContextMenu,
  onDelete,
  onDoubleClick,
  onSelect
}: WorksheetListItemProps): ReactElement {
  // The app is built around always having a worksheet open, and the list
  // endpoint would just recreate a default one.
  const canDelete = remainingWorksheetCount > deleteTargets.length

  // Renaming several rows at once means nothing, so the menu drops the item
  // rather than quietly renaming whichever one was right-clicked.
  const isRenamable = deleteTargets.length === 1

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <button
          className={cn(
            'flex h-[var(--item-h)] w-full flex-none items-center gap-2 rounded-[6px] px-2 text-left hover:bg-hover',
            isOpen || isSelected ? 'bg-sel text-text' : 'text-text2'
          )}
          data-selected={isSelected}
          type="button"
          onClick={(event) => onSelect(event, worksheet.id)}
          onContextMenu={() => onContextMenu(worksheet.id)}
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
        {isRenamable && (
          <ContextMenuItem
            className="flex items-center gap-2 min-w-32 text-xs"
            onClick={() => onDoubleClick(worksheet)}
          >
            <Pencil className="size-3" />
            Rename
          </ContextMenuItem>
        )}

        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs text-destructive focus:text-destructive"
          disabled={!canDelete}
          onClick={() => onDelete(deleteTargets)}
        >
          <Trash2 className="size-3" />
          {deleteTargets.length === 1
            ? 'Delete'
            : `Delete ${deleteTargets.length} worksheets`}
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
