import { useMutation, useQueryClient } from '@tanstack/react-query'

import { apiClient } from '../api-client'
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
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => apiClient.createWorksheet(name),
    onSuccess: (worksheet) => {
      queryClient.setQueryData<WorksheetDto[]>(queryKeys.worksheets, (old) => {
        if (!old) {
          return [worksheet]
        }

        return [...old, worksheet]
      })
    }
  })
}

export interface UpdateWorksheetInput {
  databaseId?: string | null
  content?: string
  lastOpenedAt?: number
  name?: string
}

export function useUpdateWorksheet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      updates
    }: {
      id: string
      updates: UpdateWorksheetInput
    }) => apiClient.updateWorksheet(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.worksheets })

      const previous = queryClient.getQueryData<WorksheetDto[]>(
        queryKeys.worksheets
      )

      queryClient.setQueryData<WorksheetDto[]>(queryKeys.worksheets, (old) => {
        if (!old) {
          return old
        }

        return old.map((worksheet) =>
          worksheet.id === id ? { ...worksheet, ...updates } : worksheet
        )
      })

      return { previous }
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.worksheets, context.previous)
      }
    },
    onSuccess: (worksheet) => {
      queryClient.setQueryData<WorksheetDto[]>(queryKeys.worksheets, (old) => {
        if (!old) {
          return [worksheet]
        }

        return old.map((existing) =>
          existing.id === worksheet.id ? worksheet : existing
        )
      })
    }
  })
}

export function useCreateDatabase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateDatabaseRequest) =>
      apiClient.createDatabase(request),
    onSuccess: (response) => {
      queryClient.setQueryData<DatabaseDto[]>(queryKeys.databases, (old) => {
        if (!old) {
          return [response.database]
        }

        return [...old, response.database]
      })

      if (response.updatedWorksheet) {
        const updated = response.updatedWorksheet

        queryClient.setQueryData<WorksheetDto[]>(
          queryKeys.worksheets,
          (old) => {
            if (!old) {
              return [updated]
            }

            return old.map((worksheet) =>
              worksheet.id === updated.id ? updated : worksheet
            )
          }
        )
      }
    }
  })
}

export function useUpdateDatabase() {
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
      queryClient.setQueryData<DatabaseDto[]>(queryKeys.databases, (old) => {
        if (!old) {
          return [response.database]
        }

        return old.map((existing) =>
          existing.id === response.database.id ? response.database : existing
        )
      })

      queryClient.invalidateQueries({
        queryKey: queryKeys.schema(response.database.id)
      })
    }
  })
}
