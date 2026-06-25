import { useQuery, useSuspenseQuery } from '@tanstack/react-query'

import { apiClient } from '../api-client'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { QueryDto } from '@/main/queries'
import { SchemaInfo } from '@/databases/adapter'

export const queryKeys = {
  databases: ['databases'] as const,
  queries: ['queries'] as const,
  query: (id: string) => ['query', id] as const,
  schema: (databaseId: string) => ['schema', databaseId] as const,
  worksheets: ['worksheets'] as const
}

export function useDatabases() {
  return useSuspenseQuery<DatabaseDto[]>({
    queryKey: queryKeys.databases,
    queryFn: () => apiClient.getDatabases()
  })
}

export function useWorksheets() {
  return useSuspenseQuery<WorksheetDto[]>({
    queryKey: queryKeys.worksheets,
    queryFn: () => apiClient.getWorksheets()
  })
}

export function useQueriesList() {
  return useSuspenseQuery<QueryDto[]>({
    queryKey: queryKeys.queries,
    queryFn: () => apiClient.getQueries()
  })
}

export function useDatabaseSchema(databaseId: string | undefined) {
  return useQuery<SchemaInfo>({
    queryKey: databaseId ? queryKeys.schema(databaseId) : ['schema', 'noop'],
    queryFn: () => {
      if (!databaseId) {
        throw new Error('Database id is required')
      }

      return apiClient.getDatabaseSchema(databaseId)
    },
    enabled: Boolean(databaseId),
    staleTime: Infinity
  })
}

const pollInterval = 250

export function useQueryById(queryId: string | undefined) {
  return useQuery<QueryDto>({
    queryKey: queryId ? queryKeys.query(queryId) : ['query', 'noop'],
    queryFn: () => {
      if (!queryId) {
        throw new Error('Query id is required')
      }

      return apiClient.getQuery(queryId)
    },
    enabled: Boolean(queryId),
    refetchInterval: (query) => {
      const data = query.state.data

      if (!data) {
        return pollInterval
      }

      return data.finishedAt ? false : pollInterval
    }
  })
}
