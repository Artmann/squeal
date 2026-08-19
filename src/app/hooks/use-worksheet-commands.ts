import { useCallback } from 'react'
import { toast } from 'sonner'

import { WorksheetDto } from '@/glue/worksheets'

import { useCollections } from '../collections-context'
import { useAppDispatch, useAppSelector } from '../store'
import { selectActiveWorksheetId, tabsActions } from '../store/tabs-slice'
import { getNextUntitledName } from '../worksheet-naming'
import { pickDatabaseForNewWorksheet } from '../worksheet-selection'
import { useCreateWorksheet } from './mutations'

interface CreateAndOpenWorksheetOptions {
  /** The explorer renames the new worksheet in place; the tab strip does not. */
  onCreated?: (worksheet: WorksheetDto) => void
}

/**
 * Creating a worksheet is opening one plus everything above it: which database
 * it inherits, what it is called, and what to say when the write fails. The
 * explorer and the tab strip both do this, and only one of them remembered to
 * open it properly.
 */
export function useCreateAndOpenWorksheet(
  options: CreateAndOpenWorksheetOptions = {}
): () => void {
  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)
  const createWorksheet = useCreateWorksheet()
  const openWorksheet = useOpenWorksheet()
  const { worksheets } = useCollections()

  const { onCreated } = options

  return useCallback(() => {
    // The collection, not a `useWorksheets()` live query: every call site of
    // that hook builds its own sorted derived collection, and neither the name
    // nor the database depends on the order. Reading it at click time is also
    // what stops two clicks in a row from both landing on `Untitled 2`.
    const existing = Array.from(worksheets.values())
    const databaseId = pickDatabaseForNewWorksheet(existing, activeWorksheetId)

    createWorksheet.mutate(
      {
        // `databaseId` is optional rather than nullable, so an unset one has to
        // be left out instead of sent as null.
        ...(databaseId === undefined ? {} : { databaseId }),
        name: getNextUntitledName(existing)
      },
      {
        onError: (error: unknown) => {
          const message =
            error instanceof Error ? error.message : 'Unknown error'

          toast.error('Failed to create worksheet', { description: message })
        },
        // The server-assigned worksheet, not an optimistic one — the explorer
        // opens a rename on it and needs the real id.
        onSuccess: (worksheet) => {
          openWorksheet(worksheet.id)
          onCreated?.(worksheet)
        }
      }
    )
  }, [activeWorksheetId, createWorksheet, onCreated, openWorksheet, worksheets])
}

/**
 * Opening a worksheet is two writes, not one. The tab has to appear, and
 * `lastOpenedAt` has to move — it is the sole input to both MRU fallbacks in
 * `worksheet-selection.ts`, whose whole job is resuming where the user was. A
 * worksheet opened without the touch is invisible to them.
 */
export function useOpenWorksheet(): (worksheetId: string) => void {
  const dispatch = useAppDispatch()
  const { worksheets } = useCollections()

  return useCallback(
    (worksheetId: string) => {
      dispatch(tabsActions.tabOpened(worksheetId))

      // `update` throws on a key the collection does not hold — a collection
      // that has not started syncing holds nothing, and a worksheet deleted in
      // another window is gone from one that has. The tab is already open by
      // the line above, so what the throw would cost is the rest of the
      // handler: the timestamp here, and the rename that follows on the create
      // path. Asking for the key is the whole precondition; the status is not.
      if (!worksheets.has(worksheetId)) {
        return
      }

      const transaction = worksheets.update(worksheetId, (draft) => {
        draft.lastOpenedAt = Date.now()
      })

      // The tab is already open. A failed touch costs the MRU order and nothing
      // the user asked for, so it is not worth a toast in front of them.
      void transaction.isPersisted.promise.catch((): void => undefined)
    },
    [dispatch, worksheets]
  )
}
