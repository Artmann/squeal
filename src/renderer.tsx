import { QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'

import { App } from './app/App'
import { AppShell } from './app/AppShell'
import { ThemeProvider } from './app/components/ThemeProvider'
import './app/index.css'
import { createQueryClient } from './app/query-client'
import { createStore } from './app/store'

function main() {
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Root element not found')
  }

  const store = createStore()
  const queryClient = createQueryClient()

  createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <ThemeProvider>
            <AppShell>
              <App />
              <Toaster />
            </AppShell>
          </ThemeProvider>
        </Provider>
      </QueryClientProvider>
    </React.StrictMode>
  )
}

main()
