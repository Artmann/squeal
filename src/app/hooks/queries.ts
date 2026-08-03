import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryKeys } from '../query-keys'
import { finishQueryTrace } from '../tracing/query-traces'
import type {
  QueryDto,
  SchemaInfoDto,
  UpdateStatusResponse
} from '@/glue/api/schemas'

export const queryPollInterval = 250

export function useDatabases() {
  const { databases } = useCollections()

  return useLiveSuspenseQuery(
    (builder) =>
      builder
        .from({ database: databases })
        .orderBy(({ database }) => database.sortOrder, {
          direction: 'asc',
          nulls: 'last'
        })
        .orderBy(({ database }) => database.createdAt, 'asc'),
    [databases]
  )
}

export function useWorksheets() {
  const { worksheets } = useCollections()

  // Unordered worksheets keep the newest-first behavior after the ordered
  // ones, mirroring the API.
  return useLiveSuspenseQuery(
    (builder) =>
      builder
        .from({ worksheet: worksheets })
        .orderBy(({ worksheet }) => worksheet.sortOrder, {
          direction: 'asc',
          nulls: 'last'
        })
        .orderBy(({ worksheet }) => worksheet.createdAt, 'desc'),
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

// Whether the OS keychain can encrypt stored connection secrets. Fetched once
// per session — it only changes with the OS environment.
export function useEncryptionAvailable(): boolean {
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiClient.getHealth(),
    staleTime: Infinity
  })

  return health.data?.encryptionAvailable ?? true
}

export function useDatabaseSchema(databaseId: string | undefined) {
  return useQuery<SchemaInfoDto>({
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

// Warms every database's schema in the background so search and expansion are
// instant. Reuses the same query keys as useDatabaseSchema, so a later
// per-database read is a cache hit rather than a second request. Results line
// up by index with databaseIds.
export function useDatabaseSchemas(databaseIds: string[]) {
  return useQueries({
    queries: databaseIds.map((databaseId) => ({
      queryKey: queryKeys.schema(databaseId),
      queryFn: () => apiClient.getDatabaseSchema(databaseId),
      enabled: Boolean(databaseId),
      staleTime: Infinity
    }))
  })
}

// The database server's product and release, for example "PostgreSQL 16". It
// rides along with the schema response, so reading it here is a cache hit
// rather than a request of its own. Undefined until the schema has loaded, and
// whenever the probe could not answer — a database that reports no version is
// normal, not an error.
export function useServerVersion(
  databaseId: string | undefined
): string | undefined {
  const schema = useDatabaseSchema(databaseId)

  return schema.data?.serverVersion
}

// Slow on purpose. The backend checks GitHub every few hours and this only
// reads the state it recorded, so a minute of staleness costs nothing — and
// once an update is ready there is nothing left to learn, so polling stops.
const updateStatusPollInterval = 60_000

export function useUpdateStatus() {
  return useQuery<UpdateStatusResponse>({
    queryKey: queryKeys.updateStatus,
    queryFn: () => apiClient.getUpdateStatus(),
    refetchInterval: (statusQuery) => {
      const state = statusQuery.state.data?.state

      if (state === 'ready' || state === 'unsupported') {
        return false
      }

      return updateStatusPollInterval
    },
    // A failed poll must never surface as an app-level error: an update the
    // user has not asked about is not worth an error boundary.
    throwOnError: false
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
    // finish) so the finished result always wins. Collection status is not
    // reactive, so wait for readiness instead of checking it once.
    if (!finished || !isRunning) {
      return
    }

    // Ends the query.run root span with the observed terminal state.
    finishQueryTrace(finished)

    void queries.stateWhenReady().then(() => {
      queries.utils.writeUpsert(finished)
    })
  }, [finished, isRunning, queries])
}
