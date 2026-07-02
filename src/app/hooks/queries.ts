import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryKeys } from '../query-keys'
import { QueryDto } from '@/main/queries'
import { SchemaInfo } from '@/databases/adapter'

export const queryPollInterval = 250

export function useDatabases() {
  const { databases } = useCollections()

  return useLiveSuspenseQuery(
    (builder) => builder.from({ database: databases }),
    [databases]
  )
}

export function useWorksheets() {
  const { worksheets } = useCollections()

  return useLiveSuspenseQuery(
    (builder) => builder.from({ worksheet: worksheets }),
    [worksheets]
  )
}

export function useQueriesList() {
  const { queries } = useCollections()

  return useLiveSuspenseQuery(
    (builder) => builder.from({ query: queries }),
    [queries]
  )
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

// The backend finishes queries out-of-band, so while the given query is
// unfinished this polls the single row and writes the terminal result into
// the queries collection, where the rest of the app reads it.
export function useQueryResultSync(query: QueryDto | undefined): void {
  const { queries } = useCollections()

  const queryId = query?.id
  const isRunning = Boolean(query && !query.finishedAt)

  const polled = useQuery<QueryDto>({
    queryKey: queryId ? queryKeys.query(queryId) : ['query', 'noop'],
    queryFn: () => {
      if (!queryId) {
        throw new Error('Query id is required')
      }

      return apiClient.getQuery(queryId)
    },
    enabled: Boolean(queryId) && isRunning,
    refetchInterval: (pollQuery) => {
      const data = pollQuery.state.data

      if (!data) {
        return queryPollInterval
      }

      return data.finishedAt ? false : queryPollInterval
    }
  })

  const finished = polled.data?.finishedAt ? polled.data : undefined

  useEffect(() => {
    // Also re-runs when the collection row regresses to running (for example
    // when a slow insert response lands after the poller saw the query
    // finish) so the finished result always wins.
    if (!finished || !isRunning || queries.status !== 'ready') {
      return
    }

    queries.utils.writeUpsert(finished)
  }, [finished, isRunning, queries])
}
