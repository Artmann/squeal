import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import { App } from './app/App'
import { store } from './app/store'
import './app/index.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

createRoot(root).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
)
