import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'

import { App } from './app/App'
import { AppLoader } from './app/AppLoader'
import { ThemeProvider } from './app/components/ThemeProvider'
import './app/index.css'
import { createStore } from './app/store'

async function main() {
  const bootstrapData = await window.electron.getBootstrapData()

  window.__BOOTSTRAP_DATA__ = bootstrapData

  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Root element not found')
  }

  const store = createStore()

  createRoot(root).render(
    <React.StrictMode>
      <Provider store={store}>
        <ThemeProvider>
          <AppLoader>
            <App />
            <Toaster />
          </AppLoader>
        </ThemeProvider>
      </Provider>
    </React.StrictMode>
  )
}

main()
