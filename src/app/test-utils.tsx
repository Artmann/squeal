import { configureStore } from '@reduxjs/toolkit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import type { QueryDto } from '@/glue/api/schemas'
import { WorksheetDto } from '@/glue/worksheets'

import { createCollections } from './collections'
import { CollectionsProvider } from './collections-context'
import { queryKeys } from './query-keys'
import databaseExplorerReducer, {
  DatabaseExplorerState
} from './store/database-explorer-slice'
import editorReducer, { EditorState } from './store/editor-slice'
import uiReducer, { UiState } from './store/ui-slice'

export interface RenderOptions {
  databaseExplorer?: Partial<DatabaseExplorerState>
  databases?: DatabaseDto[]
  editor?: Partial<EditorState>
  queries?: QueryDto[]
  schemas?: Record<string, SchemaInfo>
  ui?: UiState
  worksheets?: WorksheetDto[]
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false, staleTime: Infinity }
    }
  })
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {}
) {
  const queryClient = createTestQueryClient()

  if (options.databases) {
    queryClient.setQueryData(queryKeys.databases, options.databases)
  }

  if (options.worksheets) {
    queryClient.setQueryData(queryKeys.worksheets, options.worksheets)
  }

  if (options.queries) {
    queryClient.setQueryData(queryKeys.queries, options.queries)
  }

  for (const [databaseId, schema] of Object.entries(options.schemas ?? {})) {
    queryClient.setQueryData(queryKeys.schema(databaseId), schema)
  }

  // Created after seeding so the collections hydrate from the query cache
  // instead of fetching.
  const collections = createCollections(queryClient)

  const store = configureStore({
    reducer: {
      databaseExplorer: databaseExplorerReducer,
      editor: editorReducer,
      ui: uiReducer
    },
    preloadedState: {
      databaseExplorer: {
        expandedDatabases: options.databaseExplorer?.expandedDatabases ?? {},
        expandedTables: options.databaseExplorer?.expandedTables ?? {}
      },
      editor: {
        databaseSearchQuery: options.editor?.databaseSearchQuery ?? '',
        openWorksheetId: options.editor?.openWorksheetId,
        worksheetSearchQuery: options.editor?.worksheetSearchQuery ?? ''
      },
      ui: options.ui ?? {}
    }
  })

  const result = render(
    <QueryClientProvider client={queryClient}>
      <CollectionsProvider collections={collections}>
        <Provider store={store}>
          {ui}
          <Toaster />
        </Provider>
      </CollectionsProvider>
    </QueryClientProvider>
  )

  return { ...result, collections, queryClient, store }
}
