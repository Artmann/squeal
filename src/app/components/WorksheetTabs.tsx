import { closestCenter, DndContext } from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, PlusIcon, XIcon } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { useCreateWorksheet } from '../hooks/mutations'
import { useWorksheets } from '../hooks/queries'
import {
  staticListStrategy,
  useDropIndicator,
  type DropIndicator
} from '../hooks/use-drop-indicator'
import { useReorderDrag } from '../hooks/use-reorder-drag'
import {
  useWorksheetRename,
  type WorksheetRenameControls
} from '../hooks/use-worksheet-rename'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import {
  selectActiveWorksheetId,
  selectOpenWorksheetIds,
  tabsActions
} from '../store/tabs-slice'
import { getNextUntitledName } from '../worksheet-naming'
import { pickDatabaseForNewWorksheet } from '../worksheet-selection'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './ui/context-menu'
import { DropIndicatorLine } from './DropIndicatorLine'
import { WorksheetNameInput } from './WorksheetNameInput'
import { WorksheetDto } from '@/glue/worksheets'

// `mod` resolves to ⌘ on macOS and Ctrl everywhere else, so one list covers
// both platforms. The last slot jumps to the last tab rather than the ninth.
const tabHotkeys = Array.from({ length: 9 }, (_, index) => `mod+${index + 1}`)

export function WorksheetTabs(): ReactElement {
  const dispatch = useAppDispatch()
  const worksheets = useWorksheets()
  const createWorksheet = useCreateWorksheet()

  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)
  const openWorksheetIds = useAppSelector(selectOpenWorksheetIds)

  const rename = useWorksheetRename(worksheets.data)
  const { editingWorksheetId } = rename

  // Lazily initialised: `useRef(new Map())` would allocate a throwaway Map on
  // every render just to discard it.
  const tabRefs = useRef<Map<string, HTMLDivElement> | null>(null)

  tabRefs.current ??= new Map<string, HTMLDivElement>()

  const openTabs = openWorksheetIds.flatMap((id) => {
    const worksheet = worksheets.data.find((entry) => entry.id === id)

    // A tab whose worksheet has gone is dropped by `tabsReconciled`; skip it in
    // the meantime rather than rendering a nameless tab.
    return worksheet ? [worksheet] : []
  })

  const openTabIds = openTabs.map((worksheet) => worksheet.id)

  const registerTabElement = useCallback(
    (worksheetId: string, element: HTMLDivElement | null) => {
      if (element) {
        tabRefs.current?.set(worksheetId, element)

        return
      }

      // Dropping the entry keeps the map bounded by the open tabs rather than
      // every worksheet ever opened this session.
      tabRefs.current?.delete(worksheetId)
    },
    []
  )

  const handleActivate = useCallback(
    (worksheetId: string) => {
      dispatch(tabsActions.tabActivated(worksheetId))
    },
    [dispatch]
  )

  const handleClose = useCallback(
    (worksheetId: string) => {
      dispatch(tabsActions.tabClosed(worksheetId))
    },
    [dispatch]
  )

  const handleReorder = useCallback(
    (worksheetIds: string[]) => {
      dispatch(tabsActions.tabsReordered(worksheetIds))
    },
    [dispatch]
  )

  const handleNewWorksheet = useCallback(() => {
    const databaseId = pickDatabaseForNewWorksheet(
      worksheets.data,
      activeWorksheetId
    )

    createWorksheet.mutate(
      {
        // `databaseId` is optional rather than nullable, so an unset one has to
        // be left out instead of sent as null.
        ...(databaseId === undefined ? {} : { databaseId }),
        name: getNextUntitledName(worksheets.data)
      },
      {
        onError: (error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Unknown error'

          toast.error('Failed to create worksheet', { description: message })
        },
        onSuccess: (worksheet) => {
          dispatch(tabsActions.tabOpened(worksheet.id))
        }
      }
    )
  }, [activeWorksheetId, createWorksheet, dispatch, worksheets.data])

  const {
    dropIndicatorFor,
    handleDragOver,
    handleDragStart,
    resetDropIndicator
  } = useDropIndicator(openTabIds)

  // The drop indicator works off the rendered tabs, but `tabsReordered` ignores
  // an order that is not exactly the open tabs, so the drag gets the full list.
  const { handleDragEnd, sensors } = useReorderDrag({
    ids: openWorksheetIds,
    onReorder: handleReorder,
    resetDropIndicator
  })

  useHotkeys(
    'mod+w',
    (event) => {
      // A rename owns the keyboard while it is open — closing the tab out from
      // under the input would throw the edit away.
      if (!activeWorksheetId || editingWorksheetId) {
        return
      }

      // Without this the browser/Electron shortcut closes the window instead.
      event.preventDefault()
      handleClose(activeWorksheetId)
    },
    // CodeMirror is a contenteditable, and it holds focus by default, so
    // without this the shortcut is dead exactly where it is most useful.
    { enableOnContentEditable: true, enableOnFormTags: true },
    [activeWorksheetId, editingWorksheetId, handleClose]
  )

  useHotkeys(
    tabHotkeys,
    (event, hotkey) => {
      if (editingWorksheetId) {
        return
      }

      const position = Number(hotkey.keys?.[0])

      if (!position) {
        return
      }

      const worksheet =
        position === tabHotkeys.length
          ? openTabs[openTabs.length - 1]
          : openTabs[position - 1]

      if (!worksheet) {
        return
      }

      event.preventDefault()
      handleActivate(worksheet.id)
    },
    { enableOnContentEditable: true, enableOnFormTags: true },
    [editingWorksheetId, handleActivate, openTabs]
  )

  useEffect(() => {
    if (!activeWorksheetId) {
      return
    }

    // Read through the ref rather than the render-scoped alias, so the effect
    // depends only on which tab is active.
    tabRefs.current
      ?.get(activeWorksheetId)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeWorksheetId])

  return (
    <div className="h-[37px] flex-none flex items-stretch bg-panel2 border-b border-border">
      <div
        className="flex items-stretch overflow-x-auto [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        <DndContext
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          sensors={sensors}
          onDragCancel={resetDropIndicator}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDragStart={handleDragStart}
        >
          <SortableContext
            items={openTabIds}
            strategy={staticListStrategy}
          >
            {openTabs.map((worksheet, index) => (
              <WorksheetTab
                key={worksheet.id}
                dropIndicator={dropIndicatorFor(index)}
                isActive={worksheet.id === activeWorksheetId}
                registerElement={registerTabElement}
                rename={rename}
                worksheet={worksheet}
                onActivate={handleActivate}
                onClose={handleClose}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <button
        aria-label="New worksheet"
        className="flex-none self-center flex size-6 items-center justify-center ml-[6px] rounded-[5px] text-text3 hover:bg-hover hover:text-text"
        onClick={handleNewWorksheet}
        title="New worksheet"
        type="button"
      >
        <PlusIcon className="size-[11px]" />
      </button>
    </div>
  )
}

interface WorksheetTabProps {
  dropIndicator: DropIndicator
  isActive: boolean
  registerElement: (worksheetId: string, element: HTMLDivElement | null) => void
  rename: WorksheetRenameControls
  worksheet: WorksheetDto
  onActivate: (worksheetId: string) => void
  onClose: (worksheetId: string) => void
}

function WorksheetTab({
  dropIndicator,
  isActive,
  registerElement,
  rename,
  worksheet,
  onActivate,
  onClose
}: WorksheetTabProps): ReactElement {
  const isEditing = rename.editingWorksheetId === worksheet.id

  // Renaming disables the sortable, so selecting text in the input never starts
  // a drag. Only the listeners are spread onto the name button — the sortable's
  // attributes carry `role="button"`, which would clobber `role="tab"`.
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({ disabled: isEditing, id: worksheet.id })

  const setTabElement = (element: HTMLDivElement | null) => {
    setNodeRef(element)
    registerElement(worksheet.id, element)
  }

  const tabClassName = cn(
    'relative flex items-center gap-2 pl-[14px] pr-[10px] text-[12.5px] border-r border-border max-w-[200px]',
    isActive
      ? 'bg-panel text-text shadow-[inset_0_2px_0_var(--accent)]'
      : 'bg-transparent text-text2',
    isDragging && 'opacity-50'
  )

  const tabStyle = { transform: CSS.Transform.toString(transform), transition }

  const closeButton = (
    <button
      aria-label={`Close ${worksheet.name}`}
      className="flex-none flex size-4 items-center justify-center rounded-[4px] text-text3 hover:bg-hover hover:text-text"
      onClick={(event) => {
        // Closing must not also select the tab underneath.
        event.stopPropagation()
        onClose(worksheet.id)
      }}
      type="button"
    >
      <XIcon className="size-2" />
    </button>
  )

  // The context menu is left out entirely while editing: Radix hands focus back
  // to its trigger when the menu closes, which would blur the input the Rename
  // item just opened and discard the edit before a key is pressed.
  if (isEditing) {
    return (
      <div
        ref={setTabElement}
        className={tabClassName}
        role="presentation"
        style={tabStyle}
      >
        <WorksheetNameInput
          ariaLabel={`Rename ${worksheet.name}`}
          className="w-[140px]"
          editingName={rename.editingName}
          inputRef={rename.inputRef}
          worksheetId={worksheet.id}
          onEditingNameChange={rename.setEditingName}
          onKeyDown={rename.handleKeyDown}
          onRenameSubmit={rename.handleRenameSubmit}
        />

        {closeButton}
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setTabElement}
          className={tabClassName}
          role="presentation"
          style={tabStyle}
        >
          {dropIndicator && (
            <DropIndicatorLine
              orientation="horizontal"
              position={dropIndicator}
            />
          )}

          <button
            aria-selected={isActive}
            className="min-w-0 truncate whitespace-nowrap cursor-pointer"
            role="tab"
            type="button"
            onAuxClick={(event) => {
              if (event.button !== 1) {
                return
              }

              event.preventDefault()
              onClose(worksheet.id)
            }}
            onClick={() => onActivate(worksheet.id)}
            onDoubleClick={() => rename.startEditing(worksheet)}
            {...listeners}
          >
            {worksheet.name}
          </button>

          {closeButton}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs"
          onClick={() => rename.startEditing(worksheet)}
        >
          <Pencil className="size-3" />
          Rename
        </ContextMenuItem>

        <ContextMenuItem
          className="flex items-center gap-2 min-w-32 text-xs"
          onClick={() => onClose(worksheet.id)}
        >
          <XIcon className="size-3" />
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
