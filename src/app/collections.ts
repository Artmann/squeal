import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection } from '@tanstack/react-db'
import { QueryClient } from '@tanstack/react-query'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { QueryDto } from '@/main/queries'

import { apiClient } from './api-client'
import { queryKeys } from './query-keys'

export type Collections = ReturnType<typeof createCollections>

interface WorksheetPatch {
  content?: string
  databaseId?: string | null
  lastOpenedAt?: number
  name?: string
}

// The PATCH endpoint rejects null for lastOpenedAt, so only forward fields the
// backend accepts.
function toWorksheetPatch(changes: Partial<WorksheetDto>): WorksheetPatch {
  const patch: WorksheetPatch = {}

  if (changes.content !== undefined) {
    patch.content = changes.content
  }

  if (changes.databaseId !== undefined) {
    patch.databaseId = changes.databaseId
  }

  if (changes.lastOpenedAt !== undefined && changes.lastOpenedAt !== null) {
    patch.lastOpenedAt = changes.lastOpenedAt
  }

  if (changes.name !== undefined) {
    patch.name = changes.name
  }

  return patch
}

export function createCollections(queryClient: QueryClient) {
  const databases = createCollection(
    queryCollectionOptions({
      getKey: (item: DatabaseDto) => item.id,
      queryClient,
      queryFn: () => apiClient.getDatabases(),
      queryKey: queryKeys.databases
    })
  )

  const queries = createCollection(
    queryCollectionOptions({
      getKey: (item: QueryDto) => item.id,
      onInsert: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const query = mutation.modified

          const response = await apiClient.createQuery({
            content: query.content,
            databaseId: query.databaseId === '' ? undefined : query.databaseId,
            id: query.id,
            queriedAt: query.queriedAt,
            worksheetId: query.worksheetId
          })

          queries.utils.writeUpsert(response.query)
        }

        return { refetch: false }
      },
      queryClient,
      queryFn: () => apiClient.getQueries(),
      queryKey: queryKeys.queries
    })
  )

  const worksheets = createCollection(
    queryCollectionOptions({
      getKey: (item: WorksheetDto) => item.id,
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const worksheet = await apiClient.updateWorksheet(
            String(mutation.key),
            toWorksheetPatch(mutation.changes)
          )

          worksheets.utils.writeUpsert(worksheet)
        }

        return { refetch: false }
      },
      queryClient,
      queryFn: () => apiClient.getWorksheets(),
      queryKey: queryKeys.worksheets
    })
  )

  return { databases, queries, worksheets }
}
