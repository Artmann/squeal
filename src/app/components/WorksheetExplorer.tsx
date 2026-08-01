import { closestCenter, DndContext } from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { FileBracesIcon, PlusIcon } from 'lucide-react'
import {
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'

import { useCollections } from '../collections-context'
import { useDatabases, useWorksheets } from '../hooks/queries'
import { useCreateWorksheet, useReorderWorksheets } from '../hooks/mutations'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
import { useReorderDrag } from '../hooks/use-reorder-drag'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { worksheetSearchQueryUpdated } from '../store/editor-slice'
import { selectActiveWorksheetId, tabsActions } from '../store/tabs-slice'
import { getNextUntitledName } from '../worksheet-naming'
import { Input } from './ui/input'
import { DropIndicatorLine } from './DropIndicatorLine'
import { SearchInput } from './SearchInput'
import { WorksheetDto } from '@/glue/worksheets'

function useWorksheetRename(worksheets: WorksheetDto[]) {
  const { worksheets: worksheetsCollection } = useCollections()

  const [editingWorksheetId, setEditingWorksheetId] = useState<string | null>(
    null
  )
  const [editingName, setEditingName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingWorksheetId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingWorksheetId])

  const startEditing = useCallback((worksheet: WorksheetDto) => {
    setEditingWorksheetId(worksheet.id)
    setEditingName(worksheet.name)
  }, [])

  const handleRenameCancel = useCallback(() => {
    setEditingWorksheetId(null)
    setEditingName('')
  }, [])

  const handleRenameSubmit = useCallback(
    (worksheetId: string) => {
      const trimmedName = editingName.trim()

      if (!trimmedName) {
        handleRenameCancel()

        return
      }

      const worksheet = worksheets.find((w) => w.id === worksheetId)

      if (!worksheet || worksheet.name === trimmedName) {
        handleRenameCancel()

        return
      }

      setEditingWorksheetId(null)

      const transaction = worksheetsCollection.update(worksheetId, (draft) => {
        draft.name = trimmedName
      })

      void transaction.isPersisted.promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to rename worksheet', { description: message })
      })

      setEditingName('')
    },
    [editingName, handleRenameCancel, worksheetsCollection, worksheets]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, worksheetId: string) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        handleRenameSubmit(worksheetId)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        handleRenameCancel()
      }
    },
    [handleRenameCancel, handleRenameSubmit]
  )

  return {
    editingName,
    editingWorksheetId,
    handleKeyDown,
    handleRenameSubmit,
    inputRef,
    setEditingName,
    startEditing
  }
}

export function WorksheetExplorer(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useDatabases()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const worksheetSearchQuery = useAppSelector(
    (state) => state.editor.worksheetSearchQuery ?? ''
  )

  const createWorksheet = useCreateWorksheet()
  const { worksheets: worksheetsCollection } = useCollections()

  const {
    editingName,
    editingWorksheetId,
    handleKeyDown,
    handleRenameSubmit,
    inputRef,
    setEditingName,
    startEditing
  } = useWorksheetRename(worksheets.data)

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
    const name = getNextUntitledName(worksheets.data)

    createWorksheet.mutate(
      { name },
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
  }, [createWorksheet, dispatch, startEditing, touchWorksheet, worksheets.data])

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
                    isOpen={worksheet.id === openWorksheetId}
                    worksheet={worksheet}
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
      {dropIndicator && <DropIndicatorLine position={dropIndicator} />}

      {children}
    </div>
  )
}

interface WorksheetListItemProps {
  databaseName?: string
  isOpen: boolean
  worksheet: WorksheetDto
  onDoubleClick: (worksheet: WorksheetDto) => void
  onSelect: (worksheetId: string) => void
}

function WorksheetListItem({
  databaseName,
  isOpen,
  worksheet,
  onDoubleClick,
  onSelect
}: WorksheetListItemProps): ReactElement {
  return (
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
  )
}

interface WorksheetRenameInputProps {
  editingName: string
  inputRef: React.RefObject<HTMLInputElement | null>
  worksheetId: string
  onEditingNameChange: (name: string) => void
  onKeyDown: (event: React.KeyboardEvent, worksheetId: string) => void
  onRenameSubmit: (worksheetId: string) => void
}

function WorksheetRenameInput({
  editingName,
  inputRef,
  worksheetId,
  onEditingNameChange,
  onKeyDown,
  onRenameSubmit
}: WorksheetRenameInputProps): ReactElement {
  return (
    <div className="flex h-[var(--item-h)] items-center gap-2 px-2">
      <FileBracesIcon className="size-[13px] flex-none text-text3" />

      <Input
        ref={inputRef}
        className="h-[22px] rounded-[4px] px-1 py-0 text-[12.5px] shadow-none md:text-[12.5px] focus-visible:ring-0"
        value={editingName}
        onBlur={() => onRenameSubmit(worksheetId)}
        onChange={(event) => onEditingNameChange(event.target.value)}
        onKeyDown={(event) => onKeyDown(event, worksheetId)}
      />
    </div>
  )
}
