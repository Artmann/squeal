import { DndContext } from '@dnd-kit/core'
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
  useListReorder,
  type DropIndicator
} from '../hooks/use-list-reorder'
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

/** The worksheets behind the open tabs, in tab order. */
function useOpenTabs(
  openWorksheetIds: string[],
  worksheets: WorksheetDto[]
): WorksheetDto[] {
  return openWorksheetIds.flatMap((id) => {
    const worksheet = worksheets.find((entry) => entry.id === id)

    // A tab whose worksheet has gone is dropped by `tabsReconciled`; skip it in
    // the meantime rather than rendering a nameless tab.
    return worksheet ? [worksheet] : []
  })
}

/**
 * Keeps the active tab in view in the scrolling strip. Owns the element map so
 * the component only has to hand each tab's node over as it mounts.
 */
function useActiveTabScroll(
  activeWorksheetId: string | undefined
): (worksheetId: string, element: HTMLDivElement | null) => void {
  // Lazily initialised: `useRef(new Map())` would allocate a throwaway Map on
  // every render just to discard it.
  const tabRefs = useRef<Map<string, HTMLDivElement> | null>(null)

  tabRefs.current ??= new Map<string, HTMLDivElement>()

  const registerElement = useCallback(
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

  useEffect(() => {
    if (!activeWorksheetId) {
      return
    }

    tabRefs.current
      ?.get(activeWorksheetId)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeWorksheetId])

  return registerElement
}

/** Creates a worksheet on the current connection and opens it in a tab. */
function useNewWorksheet(
  activeWorksheetId: string | undefined,
  worksheets: WorksheetDto[]
): () => void {
  const dispatch = useAppDispatch()
  const createWorksheet = useCreateWorksheet()

  return useCallback(() => {
    const databaseId = pickDatabaseForNewWorksheet(
      worksheets,
      activeWorksheetId
    )

    createWorksheet.mutate(
      {
        // `databaseId` is optional rather than nullable, so an unset one has to
        // be left out instead of sent as null.
        ...(databaseId === undefined ? {} : { databaseId }),
        name: getNextUntitledName(worksheets)
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
  }, [activeWorksheetId, createWorksheet, dispatch, worksheets])
}

interface TabHotkeysOptions {
  activeWorksheetId: string | undefined
  /** Set while a tab is being renamed, which owns the keyboard. */
  editingWorksheetId: string | null
  openTabs: WorksheetDto[]
  onActivate: (worksheetId: string) => void
  onClose: (worksheetId: string) => void
}

/**
 * Closing the active tab and jumping between tabs by position. Both are
 * registered with `enableOnContentEditable` because CodeMirror is a
 * contenteditable and holds focus by default, so without it the shortcuts are
 * dead exactly where they are most useful.
 */
function useTabHotkeys(options: TabHotkeysOptions): void {
  const {
    activeWorksheetId,
    editingWorksheetId,
    openTabs,
    onActivate,
    onClose
  } = options

  useHotkeys(
    'mod+w',
    (event) => {
      // Closing the tab out from under a rename would throw the edit away.
      if (!activeWorksheetId || editingWorksheetId) {
        return
      }

      // Without this the browser/Electron shortcut closes the window instead.
      event.preventDefault()
      onClose(activeWorksheetId)
    },
    { enableOnContentEditable: true, enableOnFormTags: true },
    [activeWorksheetId, editingWorksheetId, onClose]
  )

  useHotkeys(
    tabHotkeys,
    (event, hotkey) => {
      const worksheet = editingWorksheetId
        ? undefined
        : tabAtHotkeyPosition(openTabs, Number(hotkey.keys?.[0]))

      if (!worksheet) {
        return
      }

      event.preventDefault()
      onActivate(worksheet.id)
    },
    { enableOnContentEditable: true, enableOnFormTags: true },
    [editingWorksheetId, onActivate, openTabs]
  )
}

/**
 * The tab a number shortcut selects. The last slot lands on the last tab
 * however many are open, the way browsers treat their ninth.
 */
function tabAtHotkeyPosition(
  openTabs: WorksheetDto[],
  position: number
): WorksheetDto | undefined {
  if (!position) {
    return undefined
  }

  if (position === tabHotkeys.length) {
    return openTabs[openTabs.length - 1]
  }

  return openTabs[position - 1]
}

export function WorksheetTabs(): ReactElement {
  const dispatch = useAppDispatch()
  const worksheets = useWorksheets()

  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)
  const openWorksheetIds = useAppSelector(selectOpenWorksheetIds)

  const rename = useWorksheetRename(worksheets.data)

  const openTabs = useOpenTabs(openWorksheetIds, worksheets.data)
  const openTabIds = openTabs.map((worksheet) => worksheet.id)

  const registerTabElement = useActiveTabScroll(activeWorksheetId)
  const handleNewWorksheet = useNewWorksheet(activeWorksheetId, worksheets.data)

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

  // `tabsReordered` ignores an order that is not exactly the open tabs, so the
  // reorder runs over every open id — including one whose worksheet has gone
  // and has no tab on screen. The indicator is asked for by id, so the tabs
  // rendered from `openTabs` only have to be a subsequence of that.
  const { dndContextProps, dropIndicatorFor } = useListReorder({
    axis: 'horizontal',
    ids: openWorksheetIds,
    onReorder: handleReorder
  })

  useTabHotkeys({
    activeWorksheetId,
    editingWorksheetId: rename.editingWorksheetId,
    onActivate: handleActivate,
    onClose: handleClose,
    openTabs
  })

  return (
    <div className="h-[37px] flex-none flex items-stretch bg-panel2 border-b border-border">
      <div
        className="flex items-stretch overflow-x-auto [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        <DndContext {...dndContextProps}>
          <SortableContext
            items={openTabIds}
            strategy={staticListStrategy}
          >
            {openTabs.map((worksheet) => (
              <WorksheetTab
                key={worksheet.id}
                dropIndicator={dropIndicatorFor(worksheet.id)}
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

      <ContextMenuContent
        // Radix hands focus back to the trigger when the menu closes. That
        // blurs the input Rename just opened, and a blur commits the edit, so
        // the rename would end before a single key was pressed.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
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
