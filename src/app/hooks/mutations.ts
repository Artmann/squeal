import { createOptimisticAction } from '@tanstack/react-db'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryPollInterval } from './queries'
import { queryKeys } from '../query-keys'
import { CreateDatabaseRequest } from '@/databases/schemas'
import { canceledQueryMessage } from '@/glue/queries'
import { CreateWorksheetRequest } from '@/glue/worksheets'
import { QueryDto } from '@/main/queries'

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

export function useUpdateDatabase() {
  const { databases } = useCollections()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      request
    }: {
      id: string
      request: CreateDatabaseRequest
    }) => apiClient.updateDatabase(id, request),
    onSuccess: (response) => {
      if (databases.status === 'ready') {
        databases.utils.writeUpsert(response.database)
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.schema(response.database.id)
      })
    }
  })
}
