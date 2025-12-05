import { configureStore } from '@reduxjs/toolkit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import editorReducer from '../store/editor-slice'
import uiReducer from '../store/ui-slice'
import { EditorScreen } from './EditorScreen'

const testDatabase = {
  connectionInfo: {
    database: 'testdb',
    host: 'localhost',
    password: 'secret',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  id: 'db-123',
  name: 'Test Database',
  type: 'postgres'
}

function createTestStore(initialState?: { databases?: typeof testDatabase[] }) {
  return configureStore({
    preloadedState: {
      editor: {
        databases: initialState?.databases ?? [testDatabase],
        queries: [],
        worksheets: []
      },
      ui: {
        editorScreen: { databaseId: 'db-123', type: 'edit-database' as const },
        showGettingStartedScreen: false
      }
    },
    reducer: {
      editor: editorReducer,
      ui: uiReducer
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
  return (
    <Provider store={store}>
      {children}
      <Toaster />
    </Provider>
  )
}

describe('EditorScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the edit database header', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    expect(screen.getByText('Edit database')).toBeInTheDocument()
  })

  it('renders close button', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    expect(screen.getByRole('button', { name: '' })).toBeInTheDocument()
  })

  it('pre-populates form with database values', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    expect(screen.getByLabelText('Name')).toHaveValue('Test Database')
    expect(screen.getByLabelText('Host')).toHaveValue('localhost')
    expect(screen.getByLabelText('Port')).toHaveValue(5432)
    expect(screen.getByLabelText('Username')).toHaveValue('admin')
    expect(screen.getByLabelText('Password')).toHaveValue('secret')
    expect(screen.getByLabelText('Database')).toHaveValue('testdb')
  })

  it('shows database not found message for invalid id', () => {
    const store = createTestStore({ databases: [] })

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="nonexistent" />
      </TestEnvironment>
    )

    expect(screen.getByText('Database not found.')).toBeInTheDocument()
  })

  it('closes editor screen when close button is clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    await user.click(screen.getByRole('button', { name: '' }))

    expect(store.getState().ui.editorScreen).toBeUndefined()
  })

  it('closes editor screen when cancel is clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(store.getState().ui.editorScreen).toBeUndefined()
  })

  it('updates database in store on successful save', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    const updatedDatabase = {
      ...testDatabase,
      name: 'Updated Database'
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ database: updatedDatabase }),
      ok: true
    } as Response)

    render(
      <TestEnvironment store={store}>
        <EditorScreen databaseId="db-123" />
      </TestEnvironment>
    )

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Database')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(store.getState().ui.editorScreen).toBeUndefined()
    })

    expect(store.getState().editor.databases[0].name).toEqual('Updated Database')
  })
})
