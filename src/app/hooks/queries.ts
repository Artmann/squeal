import { useLiveSuspenseQuery } from '@tanstack/react-db'
import { useQueries, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { apiClient } from '../api-client'
import { useCollections } from '../collections-context'
import { queryKeys } from '../query-keys'
import { finishQueryTrace } from '../tracing/query-traces'
import { consumeErrorNotice } from './use-start-query'
import type {
  QueryDto,
  SchemaInfoDto,
  SecretStorageResponse,
  UpdateStatusResponse
} from '@/glue/api/schemas'
import { isConnectionUnreadable, type DatabaseDto } from '@/glue/databases'
import {
  canceledQueryMessage,
  isQueryFinished,
  isQueryInFlight
} from '@/glue/queries'

const queryPollInterval = 250

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

// Whether Squeal may encrypt stored connection secrets with the OS keychain.
// AppShell reads it through useSecretStorage during its first render so the
// request travels alongside the collection loads instead of after them.
//
// staleTime: Infinity is load-bearing rather than an optimization. With the
// global 30s default, a component mounting later becomes a second observer and
// refetches — and a failed refetch on a suspense query throws the whole app onto
// the error screen mid-edit.
const secretStorageQueryOptions = {
  queryFn: () => apiClient.getSecretStorage(),
  queryKey: queryKeys.secretStorage,
  staleTime: Infinity
}

// Suspends rather than defaulting, on purpose: a non-suspending read would have
// to guess a mode before the answer arrives, and guessing 'undecided' flashes
// the consent screen at every returning user.
export function useSecretStorage(): SecretStorageResponse {
  return useSuspenseQuery(secretStorageQueryOptions).data
}

// One database's schema. Not exported: the only reader outside this module was
// the explorer's table list, which now takes its tables from the parent's
// prefetch, and nothing else should reach past `useDatabaseSchemas` for a
// single row. `useServerVersion` below is the one caller left.
function useDatabaseSchema(databaseId: string | undefined) {
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

export interface DatabaseSchemaRequest {
  databaseId: string
  /** False for a database whose schema cannot be loaded, so nothing is asked. */
  isEnabled: boolean
}

// Warms every database's schema in the background so search and expansion are
// instant, and is the source the explorer reads each row's tables from. Uses
// the same query keys as useDatabaseSchema, so the version read there is a
// cache hit rather than a second request. Results line up by index with the
// requests.
//
// A per-request `isEnabled` rather than a pre-filtered list, because callers
// line the results up with their own database array by index — dropping the
// databases that must not be asked would shift every index after them.
export function useDatabaseSchemas(requests: DatabaseSchemaRequest[]) {
  return useQueries({
    queries: requests.map(({ databaseId, isEnabled }) => ({
      queryKey: queryKeys.schema(databaseId),
      queryFn: () => apiClient.getDatabaseSchema(databaseId),
      enabled: Boolean(databaseId) && isEnabled,
      staleTime: Infinity
    }))
  })
}

// The database server's product and release, for example "PostgreSQL 16". It
// rides along with the schema response, so reading it here is a cache hit
// rather than a request of its own. Undefined until the schema has loaded, and
// whenever the probe could not answer — a database that reports no version is
// normal, not an error.
//
// Takes the row rather than its id so it can tell the two "no version" cases
// apart: a connection whose stored secret cannot be read has no schema to load,
// and asking anyway spends a failing request on an answer already known. The
// worksheet's own databaseId is not enough — it can still name a row that was
// deleted.
export function useServerVersion(
  database: DatabaseDto | undefined
): string | undefined {
  const databaseId =
    database === undefined || isConnectionUnreadable(database)
      ? undefined
      : database.id

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
  const isRunning = isQueryInFlight(query)

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

      return isQueryFinished(data) ? false : queryPollInterval
    }
  })

  const finished = isQueryFinished(polled.data) ? polled.data : undefined

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

    // A run the user did not start — "Query Table" in the sidebar — announces
    // its own failure, since nothing told the user a query was even running.
    // Switching tabs before it finishes disables this poller, so the toast is
    // missed; the error is still waiting in the results pane.
    if (
      consumeErrorNotice(finished.id) &&
      finished.error &&
      finished.error !== canceledQueryMessage
    ) {
      toast.error('Query failed', { description: finished.error })
    }

    void queries.stateWhenReady().then(() => {
      queries.utils.writeUpsert(finished)
    })
  }, [finished, isRunning, queries])
}
