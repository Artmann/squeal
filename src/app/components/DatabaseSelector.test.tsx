import { configureStore } from '@reduxjs/toolkit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import editorReducer from '../store/editor-slice'
import { DatabaseSelector } from './DatabaseSelector'

vi.mock('../api-client', () => ({
  apiClient: {
    updateWorksheet: vi.fn()
  }
}))

// Radix UI Select uses DOM APIs not available in jsdom
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  // ResizeObserver polyfill for Radix popover/portal
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof window.ResizeObserver
})

import { apiClient } from '../api-client'

const testDatabase: DatabaseDto = {
  connectionInfo: {
    host: 'localhost',
    port: 5432,
    database: 'testdb',
    username: 'admin',
    password: 'secret'
  },
  createdAt: 1704067200000,
  id: 'db-1',
  name: 'Production DB',
  type: 'postgres'
}

const testDatabase2: DatabaseDto = {
  connectionInfo: {
    host: 'localhost',
    port: 5432,
    database: 'testdb2',
    username: 'admin',
    password: 'secret'
  },
  createdAt: 1704067200000,
  id: 'db-2',
  name: 'Staging DB',
  type: 'postgres'
}

const testWorksheet: WorksheetDto = {
  content: 'SELECT * FROM users',
  createdAt: 1704067200000,
  databaseId: 'db-1',
  id: 'ws-123',
  lastOpenedAt: null,
  name: 'Test Worksheet'
}

function createTestStore(options?: {
  databases?: DatabaseDto[]
  openWorksheetId?: string
  worksheets?: WorksheetDto[]
}) {
  return configureStore({
    preloadedState: {
      editor: {
        databases: options?.databases ?? [testDatabase, testDatabase2],
        databaseSearchQuery: '',
        openWorksheetId: options?.openWorksheetId ?? 'ws-123',
        queries: [],
        schemas: {},
        worksheets: options?.worksheets ?? [testWorksheet],
        worksheetSearchQuery: ''
      }
    },
    reducer: {
      editor: editorReducer
    }
  })
}

function TestEnvironment({
  children,
  store
}: {
  children: ReactNode
  store: ReturnType<typeof createTestStore>
}) {
  return <Provider store={store}>{children}</Provider>
}

describe('DatabaseSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display the currently selected database for the open worksheet', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseSelector />
      </TestEnvironment>
    )

    expect(screen.getByText('Production DB')).toBeInTheDocument()
  })

  it('should call updateWorksheet API with the selected databaseId when user changes database', async () => {
    const user = userEvent.setup()
    const updatedWorksheet = { ...testWorksheet, databaseId: 'db-2' }

    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(updatedWorksheet)

    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseSelector />
      </TestEnvironment>
    )

    // Open the select dropdown
    await user.click(screen.getByRole('combobox'))

    // Select the second database
    await user.click(screen.getByText('Staging DB'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
        databaseId: 'db-2'
      })
    })
  })

  it('should use current worksheet data in optimistic update, not stale data', async () => {
    const user = userEvent.setup()
    const worksheet: WorksheetDto = {
      content: 'SELECT * FROM orders',
      createdAt: 1704067200000,
      databaseId: 'db-1',
      id: 'ws-123',
      lastOpenedAt: null,
      name: 'Test Worksheet'
    }

    const store = createTestStore({
      worksheets: [worksheet]
    })

    // Mock a slow API response so we can inspect the optimistic update
    vi.mocked(apiClient.updateWorksheet).mockImplementation(
      () => new Promise(() => {}) // Never resolves — lets us inspect optimistic state
    )

    render(
      <TestEnvironment store={store}>
        <DatabaseSelector />
      </TestEnvironment>
    )

    // Simulate content update (user typing in editor) before changing database
    store.dispatch({
      type: 'editor/worksheetContentUpdated',
      payload: { id: 'ws-123', content: 'SELECT * FROM updated_table' }
    })

    // Now change the database
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Staging DB'))

    // The optimistic update should preserve the updated content, not use stale data
    await waitFor(() => {
      const ws = store.getState().editor.worksheets[0]

      expect(ws.databaseId).toEqual('db-2')
      expect(ws.content).toEqual('SELECT * FROM updated_table')
    })
  })

  it('should show "No databases configured" when databases array is empty', () => {
    const store = createTestStore({ databases: [] })

    render(
      <TestEnvironment store={store}>
        <DatabaseSelector />
      </TestEnvironment>
    )

    expect(screen.getByText('No databases configured')).toBeInTheDocument()
  })
})
