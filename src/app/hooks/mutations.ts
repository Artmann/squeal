import { useMutation, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryKeys } from '../query-keys'
import { CreateDatabaseRequest } from '@/databases/schemas'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { QueryDto } from '@/main/queries'

export interface CreateQueryInput {
  content: string
  databaseId?: string
  id: string
  queriedAt: number
  worksheetId: string
}

export function useCreateQuery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateQueryInput) => apiClient.createQuery(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.queries })

      const previous = queryClient.getQueryData<QueryDto[]>(queryKeys.queries)

      const optimistic: QueryDto = {
        content: input.content,
        databaseId: input.databaseId ?? '',
        error: null,
        finishedAt: null,
        id: input.id,
        queriedAt: input.queriedAt,
        result: null,
        truncated: false,
        worksheetId: input.worksheetId
      }

      queryClient.setQueryData<QueryDto[]>(queryKeys.queries, (old) => {
        const next = old ? [...old] : []
        next.unshift(optimistic)

        return next
      })

      queryClient.setQueryData(queryKeys.query(input.id), optimistic)

      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.queries, context.previous)
      }
    },
    onSuccess: (response) => {
      queryClient.setQueryData<QueryDto[]>(queryKeys.queries, (old) => {
        if (!old) {
          return [response.query]
        }

        const index = old.findIndex((query) => query.id === response.query.id)

        if (index < 0) {
          return [response.query, ...old]
        }

        const next = [...old]
        next[index] = response.query

        return next
      })

      queryClient.setQueryData(
        queryKeys.query(response.query.id),
        response.query
      )
    }
  })
}

export function useCancelQuery() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (queryId: string) => apiClient.cancelQuery(queryId),
    onSuccess: (_result, queryId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.query(queryId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.queries })
    }
  })
}

export function useCreateWorksheet() {
  const { worksheets } = useCollections()

  return useMutation({
    mutationFn: (name: string) => apiClient.createWorksheet(name),
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
