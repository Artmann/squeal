import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryKeys } from '../query-keys'
import { DatabaseDto } from '@/glue/databases'
import { QueryDto } from '@/main/queries'
import { SchemaInfo } from '@/databases/adapter'

export { queryKeys } from '../query-keys'

export function useDatabases() {
  return useSuspenseQuery<DatabaseDto[]>({
    queryKey: queryKeys.databases,
    queryFn: () => apiClient.getDatabases()
  })
}

export function useWorksheets() {
  const { worksheets } = useCollections()

  return useLiveSuspenseQuery(
    (query) => query.from({ worksheet: worksheets }),
    [worksheets]
  )
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
