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
import tabsReducer, { type TabsState } from './store/tabs-slice'
import uiReducer, { UiState } from './store/ui-slice'

export interface RenderOptions {
  databaseExplorer?: Partial<DatabaseExplorerState>
  databases?: DatabaseDto[]
  editor?: Partial<EditorState>
  /** Convenience for the common case of one open, active worksheet. */
  openWorksheetId?: string
  queries?: QueryDto[]
  schemas?: Record<string, SchemaInfo>
  tabs?: Partial<TabsState>
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

/** Seeds the query cache so collections hydrate from it instead of fetching. */
function seedQueryCache(
  queryClient: QueryClient,
  options: RenderOptions
): void {
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
}

function createTabsState(options: RenderOptions): TabsState {
  const openWorksheetIds =
    options.tabs?.openWorksheetIds ??
    (options.openWorksheetId ? [options.openWorksheetId] : [])

  return {
    activeWorksheetId:
      options.tabs?.activeWorksheetId ??
      options.openWorksheetId ??
      openWorksheetIds[openWorksheetIds.length - 1],
    openWorksheetIds
  }
}

function createDatabaseExplorerState(
  options: RenderOptions
): DatabaseExplorerState {
  return {
    expandedDatabases: options.databaseExplorer?.expandedDatabases ?? {},
    expandedTables: options.databaseExplorer?.expandedTables ?? {}
  }
}

function createEditorState(options: RenderOptions): EditorState {
  return {
    databaseSearchQuery: options.editor?.databaseSearchQuery ?? '',
    worksheetSearchQuery: options.editor?.worksheetSearchQuery ?? ''
  }
}

function createTestStore(options: RenderOptions) {
  return configureStore({
    reducer: {
      databaseExplorer: databaseExplorerReducer,
      editor: editorReducer,
      tabs: tabsReducer,
      ui: uiReducer
    },
    preloadedState: {
      databaseExplorer: createDatabaseExplorerState(options),
      editor: createEditorState(options),
      tabs: createTabsState(options),
      ui: options.ui ?? {}
    }
  })
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {}
) {
  const queryClient = createTestQueryClient()

  seedQueryCache(queryClient, options)

  // Created after seeding so the collections hydrate from the query cache
  // instead of fetching.
  const collections = createCollections(queryClient)
  const store = createTestStore(options)

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
