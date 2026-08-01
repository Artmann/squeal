import { ChevronDownIcon, DatabaseIcon, SearchIcon } from 'lucide-react'
import {
  type KeyboardEvent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from 'react'
import invariant from 'tiny-invariant'

import { useCollections } from '../collections-context'
import { useDatabases, useWorksheets } from '../hooks/queries'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import { selectActiveWorksheetId } from '../store/tabs-slice'
import { uiActions } from '../store/ui-slice'

const triggerClassName =
  'flex h-[29px] cursor-pointer items-center gap-[7px] rounded-md border border-border bg-transparent px-[10px] text-[12.5px] text-text hover:bg-hover'

export function ConnectionPicker(): ReactElement {
  const databases = useDatabases()
  const dispatch = useAppDispatch()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const { worksheets: worksheetsCollection } = useCollections()

  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const idPrefix = useId()
  const listId = `${idPrefix}-databases`

  const currentWorksheet = useMemo(
    () => worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
    [openWorksheetId, worksheets.data]
  )

  const selectedDatabaseId = currentWorksheet?.databaseId ?? null

  const selectedDatabase = useMemo(
    () => databases.data.find((database) => database.id === selectedDatabaseId),
    [databases.data, selectedDatabaseId]
  )

  const matchingDatabases = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()

    if (search.length === 0) {
      return databases.data
    }

    return databases.data.filter((database) =>
      database.name.toLowerCase().includes(search)
    )
  }, [databases.data, searchQuery])

  const closePicker = useCallback((shouldFocusTrigger = true): void => {
    setIsOpen(false)
    setSearchQuery('')

    if (shouldFocusTrigger) {
      triggerRef.current?.focus()
    }
  }, [])

  const openPicker = useCallback((): void => {
    const selectedIndex = databases.data.findIndex(
      (database) => database.id === selectedDatabaseId
    )

    setHighlightedIndex(selectedIndex === -1 ? 0 : selectedIndex)
    setSearchQuery('')
    setIsOpen(true)
  }, [databases.data, selectedDatabaseId])

  const selectDatabase = useCallback(
    (databaseId: string): void => {
      closePicker()

      if (!openWorksheetId) {
        return
      }

      invariant(currentWorksheet, 'No current worksheet found.')

      const transaction = worksheetsCollection.update(
        openWorksheetId,
        (draft) => {
          draft.databaseId = databaseId
        }
      )

      // The optimistic change rolls back automatically if the save fails.
      void transaction.isPersisted.promise.catch((): void => undefined)
    },
    [closePicker, currentWorksheet, openWorksheetId, worksheetsCollection]
  )

  // The search field owns focus while the popover is open so typing filters
  // straight away.
  useEffect(() => {
    if (!isOpen) {
      return
    }

    searchRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target

      if (target instanceof Node && containerRef.current?.contains(target)) {
        return
      }

      // The click itself moves focus, so the trigger stays out of the way.
      setIsOpen(false)
      setSearchQuery('')
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isOpen])

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

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()

      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()

      if (matchingDatabases.length === 0) {
        return
      }

      const step = event.key === 'ArrowDown' ? 1 : -1

      setHighlightedIndex(
        (index) =>
          (index + step + matchingDatabases.length) % matchingDatabases.length
      )

      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()

      const database = matchingDatabases[highlightedIndex]

      if (!database) {
        return
      }

      selectDatabase(database.id)
    }
  }

  function handleSearchChange(value: string): void {
    setHighlightedIndex(0)
    setSearchQuery(value)
  }

  if (databases.data.length === 0) {
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
        onClick={() => (isOpen ? closePicker() : openPicker())}
      >
        <DatabaseIcon className="size-3 shrink-0 text-text3" />

        <span className="max-w-[170px] truncate">
          {selectedDatabase?.name ?? 'Select a database'}
        </span>

        <ChevronDownIcon className="size-[9px] shrink-0 text-text3" />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-[34px] z-50 min-w-[210px] rounded-lg border border-border bg-panel p-1 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
          onKeyDown={handleKeyDown}
        >
          <div className="relative m-[2px] mb-1">
            <SearchIcon className="pointer-events-none absolute left-[9px] top-1/2 size-3 -translate-y-1/2 text-text3" />

            <input
              aria-activedescendant={
                matchingDatabases.length === 0
                  ? undefined
                  : `${idPrefix}-option-${highlightedIndex}`
              }
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded
              className="h-7 w-full rounded-md border border-border bg-panel2 pl-[27px] pr-[10px] text-xs text-text outline-none focus:border-accent"
              placeholder="Search databases"
              ref={searchRef}
              role="combobox"
              type="text"
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>

          <div
            aria-label="Databases"
            className="max-h-[280px] overflow-y-auto"
            id={listId}
            role="listbox"
          >
            {matchingDatabases.length === 0 && (
              <div className="px-[10px] py-[7px] text-[12.5px] text-text2">
                No databases match that search.
              </div>
            )}

            {matchingDatabases.map((database, index) => (
              <div
                aria-selected={database.id === selectedDatabaseId}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-[5px] px-[10px] py-[7px] text-[12.5px] text-text hover:bg-hover',
                  index === highlightedIndex && 'bg-hover'
                )}
                id={`${idPrefix}-option-${index}`}
                key={database.id}
                role="option"
                onClick={() => selectDatabase(database.id)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <DatabaseIcon className="size-3 shrink-0 text-text3" />

                <span className="max-w-[200px] truncate">{database.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
