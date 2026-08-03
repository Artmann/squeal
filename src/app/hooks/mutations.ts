import { createOptimisticAction } from '@tanstack/react-db'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryPollInterval } from './queries'
import { queryKeys } from '../query-keys'
import {
  CreateDatabaseRequest,
  type CreateWorksheetRequest,
  type QueryDto,
  UpdateDatabaseRequest
} from '@/glue/api/schemas'
import { canceledQueryMessage } from '@/glue/queries'

const cancelPollAttempts = 20

// The cancel endpoint only signals the running adapter; the backend finalizes
// the row afterwards. Wait for that so the optimistic canceled state is not
// dropped before the server row catches up.
async function waitForQueryToFinish(
  queryId: string
): Promise<QueryDto | undefined> {
  for (let attempt = 0; attempt < cancelPollAttempts; attempt++) {
    const query = await apiClient.getQuery(queryId)

    if (query.finishedAt) {
      return query
    }

    await new Promise((resolve) => setTimeout(resolve, queryPollInterval))
  }

  return undefined
}

export function useCancelQuery() {
  const { queries } = useCollections()
  const [isPending, setIsPending] = useState(false)

  const cancelAction = useMemo(
    () =>
      createOptimisticAction<string>({
        onMutate: (queryId) => {
          queries.update(queryId, (draft) => {
            draft.error = canceledQueryMessage
            draft.finishedAt = Date.now()
          })
        },
        mutationFn: async (queryId) => {
          await apiClient.cancelQuery(queryId)

          const finalQuery = await waitForQueryToFinish(queryId)

          if (finalQuery && queries.status === 'ready') {
            queries.utils.writeUpsert(finalQuery)
          }
        }
      }),
    [queries]
  )

  const cancel = useCallback(
    (queryId: string) => {
      setIsPending(true)

      const transaction = cancelAction(queryId)

      void transaction.isPersisted.promise
        .catch((): void => undefined)
        .finally(() => {
          setIsPending(false)
        })
    },
    [cancelAction]
  )

  return { cancel, isPending }
}

export function useCreateWorksheet() {
  const { worksheets } = useCollections()

  return useMutation({
    mutationFn: (request: CreateWorksheetRequest) =>
      apiClient.createWorksheet(request),
    onSuccess: (worksheet) => {
      if (worksheets.status === 'ready') {
        worksheets.utils.writeInsert(worksheet)
      }
    }
  })
}

export function useCreateDatabase() {
  const { databases, worksheets } = useCollections()

  return useMutation({
    mutationFn: (request: CreateDatabaseRequest) =>
      apiClient.createDatabase(request),
    onSuccess: (response) => {
      // Manual writes reconcile already-synced state. A collection that has
      // not started syncing will fetch fresh data, new row included, on first
      // read instead.
      if (databases.status === 'ready') {
        databases.utils.writeInsert(response.database)
      }

      if (response.updatedWorksheet && worksheets.status === 'ready') {
        worksheets.utils.writeUpsert(response.updatedWorksheet)
      }
    }
  })
}

export function useDeleteDatabase() {
  const { databases } = useCollections()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (databaseId: string) => apiClient.deleteDatabase(databaseId),
    onSuccess: (_, databaseId) => {
      if (databases.status === 'ready') {
        databases.utils.writeDelete(databaseId)
      }

      // The backend detaches worksheets that pointed at the database, and the
      // cached schema belongs to a connection that no longer exists.
      queryClient.removeQueries({ queryKey: queryKeys.schema(databaseId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.worksheets })
    }
  })
}

export function useDeleteWorksheet() {
  const { worksheets } = useCollections()

  return useMutation({
    mutationFn: (worksheetId: string) => apiClient.deleteWorksheet(worksheetId),
    onSuccess: (_, worksheetId) => {
      if (worksheets.status === 'ready') {
        worksheets.utils.writeDelete(worksheetId)
      }

      // No tab bookkeeping here on purpose: `tabsReconciled` runs on every
      // worksheets update and drops tabs whose worksheet is gone, picking the
      // next one to focus.
    }
  })
}

// The response is answered before the app quits, so a success here means the
// restart is coming, not that it has happened. Nothing is invalidated on
// purpose: this window is about to close.
export function useInstallUpdate() {
  return useMutation({
    mutationFn: () => apiClient.installUpdate()
  })
}

export function useReorderDatabases() {
  const { databases } = useCollections()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (databaseIds: string[]) =>
      apiClient.reorderDatabases(databaseIds),
    onMutate: (databaseIds) => {
      // Optimistic partial upsert so the list re-sorts immediately instead of
      // snapping back while the request is in flight.
      if (databases.status === 'ready') {
        databases.utils.writeUpsert(
          databaseIds.map((id, index) => ({ id, sortOrder: index }))
        )
      }
    },
    onSuccess: (response) => {
      if (databases.status === 'ready') {
        databases.utils.writeUpsert(response.databases)
      }
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.databases })
    }
  })
}

export function useReorderWorksheets() {
  const { worksheets } = useCollections()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (worksheetIds: string[]) =>
      apiClient.reorderWorksheets(worksheetIds),
    onMutate: (worksheetIds) => {
      // Optimistic partial upsert so the list re-sorts immediately instead of
      // snapping back while the request is in flight.
      if (worksheets.status === 'ready') {
        worksheets.utils.writeUpsert(
          worksheetIds.map((id, index) => ({ id, sortOrder: index }))
        )
      }
    },
    onSuccess: (response) => {
      if (worksheets.status === 'ready') {
        worksheets.utils.writeUpsert(response.worksheets)
      }
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.worksheets })
    }
  })
}

export function useUpdateDatabase() {
  const { databases } = useCollections()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      request
    }: {
      id: string
      request: UpdateDatabaseRequest
    }) => apiClient.updateDatabase(id, request),
    onSuccess: (response) => {
      if (databases.status === 'ready') {
        databases.utils.writeUpsert(response.database)
      }

      void queryClient.invalidateQueries({
        queryKey: queryKeys.schema(response.database.id)
      })
    }
  })
}
