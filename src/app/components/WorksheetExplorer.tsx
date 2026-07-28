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
import { useWorksheets } from '../hooks/queries'
import { useCreateWorksheet, useReorderWorksheets } from '../hooks/mutations'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
import { useReorderDrag } from '../hooks/use-reorder-drag'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import {
  worksheetSearchQueryUpdated,
  worksheetSelected
} from '../store/editor-slice'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { DropIndicatorLine } from './DropIndicatorLine'
import { SearchInput } from './SearchInput'
import { WorksheetDto } from '@/glue/worksheets'

function getNextUntitledName(worksheets: WorksheetDto[]): string {
  const untitledCount = worksheets.filter(
    (worksheet) =>
      worksheet.name === 'Untitled' || /^Untitled \d+$/.test(worksheet.name)
  ).length

  return untitledCount === 0 ? 'Untitled' : `Untitled ${untitledCount + 1}`
}

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
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
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
      dispatch(worksheetSelected(worksheetId))
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
          dispatch(worksheetSelected(worksheet.id))
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

  return (
    <div className="flex flex-col h-full">
      <div className="mb-2 flex justify-between items-center">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-subtext-0">
          Worksheets
        </h2>
        <div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleNewWorksheet}
          >
            <PlusIcon className="size-3" />
          </Button>
        </div>
      </div>

      <div className="mb-2">
        <SearchInput
          value={worksheetSearchQuery}
          onChange={(newValue) =>
            dispatch(worksheetSearchQueryUpdated(newValue))
          }
        />
      </div>

      <div className="flex flex-col gap-1 flex-1 min-h-0 overflow-y-auto">
        {filteredWorksheets.length === 0 && (
          <p className="text-xs text-subtext-0 px-1 mt-1 leading-relaxed">
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
      className={cn('relative', isDragging && 'opacity-50')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(isSortingDisabled ? {} : listeners)}
    >
      {dropIndicator && <DropIndicatorLine position={dropIndicator} />}

      {children}
    </div>
  )
}

interface WorksheetListItemProps {
  isOpen: boolean
  worksheet: WorksheetDto
  onDoubleClick: (worksheet: WorksheetDto) => void
  onSelect: (worksheetId: string) => void
}

function WorksheetListItem({
  isOpen,
  worksheet,
  onDoubleClick,
  onSelect
}: WorksheetListItemProps): ReactElement {
  return (
    <Button
      className={cn(
        'w-full px-3 py-0.5 text-left flex justify-start items-center gap-2 text-xs font-normal',
        isOpen
          ? 'bg-mauve/10 text-mauve shadow-[inset_2px_0_0_var(--color-mauve)]'
          : ''
      )}
      size="sm"
      variant="ghost"
      onClick={() => onSelect(worksheet.id)}
      onDoubleClick={() => onDoubleClick(worksheet)}
    >
      <FileBracesIcon />
      {worksheet.name}
    </Button>
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
    <div className="flex items-center gap-2 px-3 py-0.5">
      <FileBracesIcon className="size-4 shrink-0" />
      <Input
        ref={inputRef}
        className="h-5 text-[11px] px-1 py-0"
        value={editingName}
        onBlur={() => onRenameSubmit(worksheetId)}
        onChange={(event) => onEditingNameChange(event.target.value)}
        onKeyDown={(event) => onKeyDown(event, worksheetId)}
      />
    </div>
  )
}
