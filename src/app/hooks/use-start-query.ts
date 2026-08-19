import { useCallback } from 'react'
import { toast } from 'sonner'
import { v7 } from 'uuid'

import { useCollections } from '../collections-context'
import { finishQueryTrace, startQueryTrace } from '../tracing/query-traces'
import type { QueryDto } from '@/glue/api/schemas'

interface StartQueryInput {
  content: string
  databaseId: string | null | undefined
  // Set when the run was not started by the user pressing Run, so a failure
  // that only shows up in the results pane would otherwise go unannounced.
  notifyOnError?: boolean
  worksheetId: string | null | undefined
}

// Queries whose failure deserves a toast. The result poller lives in `App`,
// far from whatever started the run, so the client-generated query id is the
// correlation key — the same bridge `activeQuerySpans` builds for traces.
const errorNoticeQueryIds = new Set<string>()

// A query that is never polled to completion leaves its id behind, so the set
// is capped and evicts the oldest entry rather than growing for the lifetime of
// the window.
const maximumErrorNotices = 20

export function consumeErrorNotice(queryId: string): boolean {
  return errorNoticeQueryIds.delete(queryId)
}

function createOptimisticQuery(input: StartQueryInput): QueryDto {
  return {
    content: input.content,
    databaseId: input.databaseId ?? '',
    error: null,
    finishedAt: null,
    id: v7(),
    queriedAt: Date.now(),
    result: null,
    worksheetId: input.worksheetId ?? ''
  }
}

function requestErrorNotice(queryId: string): void {
  if (errorNoticeQueryIds.size >= maximumErrorNotices) {
    const [oldest] = errorNoticeQueryIds

    errorNoticeQueryIds.delete(oldest)
  }

  errorNoticeQueryIds.add(queryId)
}

/**
 * Starts a query and hands it to the collection, which is what turns it into a
 * `POST /queries`. Everything about *what* to run — the active statement, the
 * pending autosave — belongs to the caller.
 */
export function useStartQuery(): (input: StartQueryInput) => void {
  const { queries: queriesCollection } = useCollections()

  return useCallback(
    (input: StartQueryInput) => {
      const optimistic = createOptimisticQuery(input)

      if (input.notifyOnError) {
        requestErrorNotice(optimistic.id)
      }

      startQueryTrace(optimistic)

      const transaction = queriesCollection.insert(optimistic)

      // The optimistic row rolls back automatically if the create fails.
      void transaction.isPersisted.promise.catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Failed to run query'

        consumeErrorNotice(optimistic.id)
        finishQueryTrace({ error: message, id: optimistic.id })
        toast.error('Query failed', { description: message })
      })
    },
    [queriesCollection]
  )
}
