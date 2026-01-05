import { configureStore } from '@reduxjs/toolkit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import editorReducer from '../store/editor-slice'
import uiReducer from '../store/ui-slice'
import { EditorScreen } from './EditorScreen'

const testDatabase: DatabaseDto = {
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

function createTestStore(initialState?: {
  databases?: (typeof testDatabase)[]
}) {
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
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
      </TestEnvironment>
    )

    expect(screen.getByText('Edit database')).toBeInTheDocument()
  })

  it('renders close button', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
      </TestEnvironment>
    )

    expect(screen.getByRole('button', { name: '' })).toBeInTheDocument()
  })

  it('pre-populates form with database values', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
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
        <EditorScreen
          databaseId="nonexistent"
          mode="edit"
        />
      </TestEnvironment>
    )

    expect(screen.getByText('Database not found.')).toBeInTheDocument()
  })

  it('closes editor screen when close button is clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
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
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
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
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />
      </TestEnvironment>
    )

    const nameInput = screen.getByLabelText('Name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Updated Database')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(store.getState().ui.editorScreen).toBeUndefined()
    })

    expect(store.getState().editor.databases[0].name).toEqual(
      'Updated Database'
    )
  })

  describe('create mode', () => {
    function createCreateModeStore() {
      return configureStore({
        preloadedState: {
          editor: {
            databases: [],
            queries: [],
            worksheets: []
          },
          ui: {
            editorScreen: { type: 'create-database' as const },
            showGettingStartedScreen: false
          }
        },
        reducer: {
          editor: editorReducer,
          ui: uiReducer
        }
      })
    }

    it('renders "Add database" header in create mode', () => {
      const store = createCreateModeStore()

      render(
        <TestEnvironment store={store}>
          <EditorScreen mode="create" />
        </TestEnvironment>
      )

      expect(screen.getByText('Add database')).toBeInTheDocument()
    })

    it('starts with empty form in create mode', () => {
      const store = createCreateModeStore()

      render(
        <TestEnvironment store={store}>
          <EditorScreen mode="create" />
        </TestEnvironment>
      )

      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(screen.getByLabelText('Host')).toHaveValue('')
      expect(screen.getByLabelText('Username')).toHaveValue('')
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Database')).toHaveValue('')
    })

    it('adds database to store on successful save in create mode', async () => {
      const user = userEvent.setup()
      const store = createCreateModeStore()

      const newDatabase: DatabaseDto = {
        connectionInfo: {
          database: 'newdb',
          host: 'newhost',
          password: 'newpass',
          port: 5432,
          username: 'newuser'
        },
        createdAt: Date.now(),
        id: 'new-db-id',
        name: 'New Database',
        type: 'postgres'
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ database: newDatabase }),
        ok: true
      } as Response)

      render(
        <TestEnvironment store={store}>
          <EditorScreen mode="create" />
        </TestEnvironment>
      )

      await user.type(screen.getByLabelText('Name'), 'New Database')
      await user.type(screen.getByLabelText('Host'), 'newhost')
      await user.type(screen.getByLabelText('Username'), 'newuser')
      await user.type(screen.getByLabelText('Password'), 'newpass')
      await user.type(screen.getByLabelText('Database'), 'newdb')

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })

      expect(store.getState().editor.databases).toHaveLength(1)
      expect(store.getState().editor.databases[0].name).toEqual('New Database')
    })

    it('closes editor screen after successful create', async () => {
      const user = userEvent.setup()
      const store = createCreateModeStore()

      const newDatabase: DatabaseDto = {
        connectionInfo: {
          database: 'testdb',
          host: 'localhost',
          password: 'pass',
          port: 5432,
          username: 'user'
        },
        createdAt: Date.now(),
        id: 'new-id',
        name: 'Test',
        type: 'postgres'
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ database: newDatabase }),
        ok: true
      } as Response)

      render(
        <TestEnvironment store={store}>
          <EditorScreen mode="create" />
        </TestEnvironment>
      )

      await user.type(screen.getByLabelText('Name'), 'Test')
      await user.type(screen.getByLabelText('Host'), 'localhost')
      await user.type(screen.getByLabelText('Username'), 'user')
      await user.type(screen.getByLabelText('Password'), 'pass')
      await user.type(screen.getByLabelText('Database'), 'testdb')

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })
    })
  })
})
