import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'

import { App } from './app/App'
import { AppShell } from './app/AppShell'
import { createCollections } from './app/collections'
import { CollectionsProvider } from './app/collections-context'
import { ThemeProvider } from './app/components/ThemeProvider'
import { TraceDashboardHost } from './app/components/traces/TraceDashboardHost'
import './app/index.css'
import { createQueryClient } from './app/query-client'
import { createStore } from './app/store'
import { initTracing } from './app/tracing/init'

function main() {
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Root element not found')
  }

  initTracing()

  const store = createStore()
  const queryClient = createQueryClient()
  const collections = createCollections(queryClient)

  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <CollectionsProvider collections={collections}>
          <Provider store={store}>
            <ThemeProvider>
              <AppShell>
                <App />
                <Toaster />
              </AppShell>

              {/* Outside AppShell so traces stay reachable when app data
                  fails to load — that is when they matter most. */}
              <TraceDashboardHost />
            </ThemeProvider>
          </Provider>
        </CollectionsProvider>
      </QueryClientProvider>
    </React.StrictMode>
  )
}

main()
