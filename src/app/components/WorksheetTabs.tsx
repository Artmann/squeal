import { PlusIcon, XIcon } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { useCreateWorksheet } from '../hooks/mutations'
import { useWorksheets } from '../hooks/queries'
import { cn } from '../lib/utils'
import { useAppDispatch, useAppSelector } from '../store'
import {
  selectActiveWorksheetId,
  selectOpenWorksheetIds,
  tabsActions
} from '../store/tabs-slice'
import { getNextUntitledName } from '../worksheet-naming'

export function WorksheetTabs(): ReactElement {
  const dispatch = useAppDispatch()
  const worksheets = useWorksheets()
  const createWorksheet = useCreateWorksheet()

  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)
  const openWorksheetIds = useAppSelector(selectOpenWorksheetIds)

  const tabRefs = useRef(new Map<string, HTMLDivElement>())

  const openTabs = openWorksheetIds.flatMap((id) => {
    const worksheet = worksheets.data.find((entry) => entry.id === id)

    // A tab whose worksheet has gone is dropped by `tabsReconciled`; skip it in
    // the meantime rather than rendering a nameless tab.
    return worksheet ? [worksheet] : []
  })

  const handleClose = useCallback(
    (worksheetId: string) => {
      dispatch(tabsActions.tabClosed(worksheetId))
    },
    [dispatch]
  )

  const handleNewWorksheet = useCallback(() => {
    createWorksheet.mutate(
      { name: getNextUntitledName(worksheets.data) },
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
  }, [createWorksheet, dispatch, worksheets.data])

  useHotkeys(
    'mod+w',
    (event) => {
      if (!activeWorksheetId) {
        return
      }

      // Without this the browser/Electron shortcut closes the window instead.
      event.preventDefault()
      handleClose(activeWorksheetId)
    },
    { enableOnFormTags: true },
    [activeWorksheetId, handleClose]
  )

  useEffect(() => {
    if (!activeWorksheetId) {
      return
    }

    tabRefs.current
      .get(activeWorksheetId)
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeWorksheetId])

  return (
    <div className="h-[37px] flex-none flex items-stretch bg-panel2 border-b border-border">
      <div
        className="flex items-stretch overflow-x-auto [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {openTabs.map((worksheet) => {
          const isActive = worksheet.id === activeWorksheetId

          return (
            <div
              className={cn(
                'flex items-center gap-2 pl-[14px] pr-[10px] text-[12.5px] border-r border-border max-w-[200px]',
                isActive
                  ? 'bg-panel text-text shadow-[inset_0_2px_0_var(--accent)]'
                  : 'bg-transparent text-text2'
              )}
              key={worksheet.id}
              ref={(element) => {
                if (element) {
                  tabRefs.current.set(worksheet.id, element)

                  return
                }

                // Dropping the entry keeps the map bounded by the open tabs
                // rather than every worksheet ever opened this session.
                tabRefs.current.delete(worksheet.id)
              }}
              role="presentation"
            >
              <button
                aria-selected={isActive}
                className="min-w-0 truncate whitespace-nowrap cursor-pointer"
                onAuxClick={(event) => {
                  if (event.button !== 1) {
                    return
                  }

                  event.preventDefault()
                  handleClose(worksheet.id)
                }}
                onClick={() => {
                  dispatch(tabsActions.tabActivated(worksheet.id))
                }}
                role="tab"
                type="button"
              >
                {worksheet.name}
              </button>

              <button
                aria-label={`Close ${worksheet.name}`}
                className="flex-none flex size-4 items-center justify-center rounded-[4px] text-text3 hover:bg-hover hover:text-text"
                onClick={(event) => {
                  // Closing must not also select the tab underneath.
                  event.stopPropagation()
                  handleClose(worksheet.id)
                }}
                type="button"
              >
                <XIcon className="size-2" />
              </button>
            </div>
          )
        })}
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
