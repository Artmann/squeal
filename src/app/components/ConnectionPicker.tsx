import { ChevronDownIcon, DatabaseIcon, SearchIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import invariant from 'tiny-invariant'

import type { DatabaseDto } from '@/glue/databases'

import { useCollections } from '../collections-context'
import { useDatabases, useWorksheets } from '../hooks/queries'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { selectActiveWorksheetId } from '../store/tabs-slice'
import { uiActions } from '../store/ui-slice'

const triggerClassName =
  'flex h-[29px] cursor-pointer items-center gap-[7px] rounded-md border border-border bg-transparent px-[10px] text-[12.5px] text-text hover:bg-hover'

/** How far the highlight moves for a key, or 0 when the key is not an arrow. */
function arrowStep(key: string): number {
  if (key === 'ArrowDown') {
    return 1
  }

  if (key === 'ArrowUp') {
    return -1
  }

  return 0
}

interface PickerKeyDownOptions {
  databases: DatabaseDto[]
  highlightedIndex: number
  onClose: () => void
  onHighlight: (updater: (index: number) => number) => void
  onSelect: (databaseId: string) => void
}

/** Escape closes, Enter selects the highlight, arrows move it with wrapping. */
function handlePickerKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  {
    databases,
    highlightedIndex,
    onClose,
    onHighlight,
    onSelect
  }: PickerKeyDownOptions
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()

    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()

    const database = databases[highlightedIndex]

    if (database) {
      onSelect(database.id)
    }

    return
  }

  const step = arrowStep(event.key)

  if (step === 0 || databases.length === 0) {
    return
  }

  event.preventDefault()
  onHighlight((index) => (index + step + databases.length) % databases.length)
}

interface PopoverBehaviourOptions {
  containerRef: RefObject<HTMLDivElement | null>
  highlightedIndex: number
  idPrefix: string
  isOpen: boolean
  searchRef: RefObject<HTMLInputElement | null>
  onDismiss: () => void
}

/**
 * The three things an open popover has to do: own focus, close on an outside
 * click, and keep the highlighted option in view. Kept together so the
 * component itself stays readable.
 */
function usePopoverBehaviour({
  containerRef,
  highlightedIndex,
  idPrefix,
  isOpen,
  searchRef,
  onDismiss
}: PopoverBehaviourOptions): void {
  // The search field owns focus while the popover is open so typing filters
  // straight away.
  useEffect(() => {
    if (!isOpen) {
      return
    }

    searchRef.current?.focus()
  }, [isOpen, searchRef])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }

      onDismiss()
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [containerRef, isOpen, onDismiss])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const option = document.getElementById(
      `${idPrefix}-option-${highlightedIndex}`
    )

    // jsdom has no layout, so scrollIntoView is missing there.
    option?.scrollIntoView?.({ block: 'nearest' })
  }, [highlightedIndex, idPrefix, isOpen])
}

/** An empty search matches everything, so no special case is needed. */
function findMatchingDatabases(
  databases: DatabaseDto[],
  searchQuery: string
): DatabaseDto[] {
  const search = searchQuery.trim().toLowerCase()

  return databases.filter((database) =>
    database.name.toLowerCase().includes(search)
  )
}

function findDatabaseIndex(
  databases: DatabaseDto[],
  databaseId: string | null
): number {
  return databases.findIndex((database) => database.id === databaseId)
}

type WorksheetsCollection = ReturnType<typeof useCollections>['worksheets']

/** Points the worksheet at a database. Rolls back on its own if the save fails. */
function assignWorksheetDatabase(
  collection: WorksheetsCollection,
  worksheetId: string,
  databaseId: string
): void {
  const transaction = collection.update(worksheetId, (draft) => {
    draft.databaseId = databaseId
  })

  void transaction.isPersisted.promise.catch((): void => undefined)
}

/** Which database the active worksheet runs against, and how to change it. */
function useWorksheetDatabase() {
  const databases = useDatabases()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const { worksheets: worksheetsCollection } = useCollections()

  const currentWorksheet = useMemo(
    () => worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
    [openWorksheetId, worksheets.data]
  )

  const selectedDatabaseId = currentWorksheet?.databaseId ?? null

  const assign = useCallback(
    (databaseId: string): void => {
      if (!openWorksheetId) {
        return
      }

      invariant(currentWorksheet, 'No current worksheet found.')

      assignWorksheetDatabase(worksheetsCollection, openWorksheetId, databaseId)
    },
    [currentWorksheet, openWorksheetId, worksheetsCollection]
  )

  return { assign, databases: databases.data, selectedDatabaseId }
}

/** Open/closed, the search text, and which option is highlighted. */
function usePickerState(selectedIndex: number) {
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((): void => {
    setIsOpen(false)
    setSearchQuery('')
    triggerRef.current?.focus()
  }, [])

  const dismiss = useCallback((): void => {
    // The outside click has already moved focus somewhere the user chose, so
    // the trigger deliberately stays out of the way.
    setIsOpen(false)
    setSearchQuery('')
  }, [])

  const open = useCallback((): void => {
    setHighlightedIndex(Math.max(0, selectedIndex))
    setSearchQuery('')
    setIsOpen(true)
  }, [selectedIndex])

  const changeSearch = useCallback((value: string): void => {
    setHighlightedIndex(0)
    setSearchQuery(value)
  }, [])

  return {
    changeSearch,
    close,
    dismiss,
    highlightedIndex,
    isOpen,
    open,
    searchQuery,
    setHighlightedIndex,
    triggerRef
  }
}

function useConnectionPicker() {
  const { assign, databases, selectedDatabaseId } = useWorksheetDatabase()

  const selectedIndex = findDatabaseIndex(databases, selectedDatabaseId)
  const state = usePickerState(selectedIndex)

  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const idPrefix = useId()

  const matchingDatabases = useMemo(
    () => findMatchingDatabases(databases, state.searchQuery),
    [databases, state.searchQuery]
  )

  const { close } = state

  const selectDatabase = useCallback(
    (databaseId: string): void => {
      close()
      assign(databaseId)
    },
    [assign, close]
  )

  usePopoverBehaviour({
    containerRef,
    highlightedIndex: state.highlightedIndex,
    idPrefix,
    isOpen: state.isOpen,
    searchRef,
    onDismiss: state.dismiss
  })

  return {
    ...state,
    containerRef,
    hasDatabases: databases.length > 0,
    idPrefix,
    listId: `${idPrefix}-databases`,
    matchingDatabases,
    searchRef,
    selectDatabase,
    selectedDatabase: databases[selectedIndex],
    selectedDatabaseId
  }
}

export function ConnectionPicker(): ReactElement {
  const dispatch = useAppDispatch()

  const {
    changeSearch,
    close,
    containerRef,
    hasDatabases,
    highlightedIndex,
    idPrefix,
    isOpen,
    listId,
    matchingDatabases,
    open,
    searchQuery,
    searchRef,
    selectDatabase,
    selectedDatabase,
    selectedDatabaseId,
    setHighlightedIndex,
    triggerRef
  } = useConnectionPicker()

  if (!hasDatabases) {
    return (
      <button
        aria-haspopup="dialog"
        className={triggerClassName}
        type="button"
        onClick={() => dispatch(uiActions.openCreateDatabase())}
      >
        <DatabaseIcon className="size-3 shrink-0 text-text3" />
        <span>No database</span>
      </button>
    )
  }

  return (
    <div
      className="relative"
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={triggerClassName}
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
      >
        <DatabaseIcon className="size-3 shrink-0 text-text3" />

        <span className="max-w-[170px] truncate">
          {selectedDatabase?.name ?? 'Select a database'}
        </span>

        <ChevronDownIcon className="size-[9px] shrink-0 text-text3" />
      </button>

      {isOpen && (
        <ConnectionPopover
          databases={matchingDatabases}
          highlightedIndex={highlightedIndex}
          idPrefix={idPrefix}
          listId={listId}
          searchQuery={searchQuery}
          searchRef={searchRef}
          selectedDatabaseId={selectedDatabaseId}
          onHighlight={setHighlightedIndex}
          onKeyDown={(event) =>
            handlePickerKeyDown(event, {
              databases: matchingDatabases,
              highlightedIndex,
              onClose: close,
              onHighlight: setHighlightedIndex,
              onSelect: selectDatabase
            })
          }
          onSearchChange={changeSearch}
          onSelect={selectDatabase}
        />
      )}
    </div>
  )
}

interface ConnectionPopoverProps {
  databases: DatabaseDto[]
  highlightedIndex: number
  idPrefix: string
  listId: string
  searchQuery: string
  searchRef: RefObject<HTMLInputElement | null>
  selectedDatabaseId: string | null
  onHighlight: (index: number) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onSearchChange: (value: string) => void
  onSelect: (databaseId: string) => void
}

function ConnectionPopover({
  databases,
  highlightedIndex,
  idPrefix,
  listId,
  searchQuery,
  searchRef,
  selectedDatabaseId,
  onHighlight,
  onKeyDown,
  onSearchChange,
  onSelect
}: ConnectionPopoverProps): ReactElement {
  return (
    <div
      className="absolute right-0 top-[34px] z-50 min-w-[210px] rounded-lg border border-border bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
      onKeyDown={onKeyDown}
    >
      <div className="relative m-[2px] mb-1">
        <SearchIcon className="pointer-events-none absolute left-[9px] top-1/2 size-3 -translate-y-1/2 text-text3" />

        <input
          aria-activedescendant={
            databases.length === 0
              ? undefined
              : `${idPrefix}-option-${highlightedIndex}`
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded
          aria-label="Search databases"
          className="h-7 w-full rounded-md border border-border bg-panel2 pl-[27px] pr-[10px] text-xs text-text outline-none focus:border-accent"
          placeholder="Search databases"
          ref={searchRef}
          role="combobox"
          type="text"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div
        aria-label="Databases"
        className="max-h-[280px] overflow-y-auto"
        id={listId}
        role="listbox"
      >
        {databases.length === 0 && (
          <div className="px-[10px] py-[7px] text-[12.5px] text-text2">
            No databases match that search.
          </div>
        )}

        {databases.map((database, index) => (
          <div
            aria-selected={database.id === selectedDatabaseId}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-[5px] px-[10px] py-[7px] text-[12.5px] text-text hover:bg-hover',
              index === highlightedIndex && 'bg-hover'
            )}
            id={`${idPrefix}-option-${index}`}
            key={database.id}
            role="option"
            onClick={() => onSelect(database.id)}
            onMouseEnter={() => onHighlight(index)}
          >
            <DatabaseIcon className="size-3 shrink-0 text-text3" />

            <span className="max-w-[200px] truncate">{database.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
