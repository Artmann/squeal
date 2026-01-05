import { configureStore } from '@reduxjs/toolkit'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import databaseExplorerReducer from '../store/database-explorer-slice'
import editorReducer from '../store/editor-slice'
import uiReducer from '../store/ui-slice'
import { DatabaseExplorer } from './DatabaseExplorer'

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

const testSchema: SchemaInfo = {
  databaseName: 'testdb',
  tables: [
    {
      columns: [
        {
          columnName: 'id',
          dataType: 'integer',
          defaultValue: null,
          isNullable: false,
          isPrimaryKey: true,
          ordinalPosition: 1
        },
        {
          columnName: 'name',
          dataType: 'varchar',
          defaultValue: null,
          isNullable: true,
          isPrimaryKey: false,
          ordinalPosition: 2
        }
      ],
      foreignKeys: [],
      tableName: 'users',
      tableSchema: 'public'
    },
    {
      columns: [
        {
          columnName: 'id',
          dataType: 'integer',
          defaultValue: null,
          isNullable: false,
          isPrimaryKey: true,
          ordinalPosition: 1
        }
      ],
      foreignKeys: [],
      tableName: 'posts',
      tableSchema: 'public'
    }
  ]
}

function createTestStore(options?: {
  databases?: DatabaseDto[]
  expandedDatabases?: Record<string, boolean>
  expandedTables?: Record<string, boolean>
  schemas?: Record<string, SchemaInfo>
}) {
  return configureStore({
    preloadedState: {
      databaseExplorer: {
        expandedDatabases: options?.expandedDatabases ?? {},
        expandedTables: options?.expandedTables ?? {}
      },
      editor: {
        databases: options?.databases ?? [testDatabase],
        databaseSearchQuery: '',
        queries: [],
        schemas: options?.schemas ?? { 'db-123': testSchema },
        worksheets: []
      },
      ui: {
        showGettingStartedScreen: false
      }
    },
    reducer: {
      databaseExplorer: databaseExplorerReducer,
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
  return <Provider store={store}>{children}</Provider>
}

describe('DatabaseExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Database Explorer')).toBeInTheDocument()
  })

  it('renders the search input', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('renders database names', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Test Database')).toBeInTheDocument()
  })

  it('shows no databases message when list is empty', () => {
    const store = createTestStore({ databases: [] })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('No databases found.')).toBeInTheDocument()
  })

  it('filters databases by search query', async () => {
    const user = userEvent.setup()
    const databases = [
      { ...testDatabase, id: 'db-1', name: 'Production' },
      { ...testDatabase, id: 'db-2', name: 'Staging' },
      { ...testDatabase, id: 'db-3', name: 'Development' }
    ]
    const store = createTestStore({ databases, schemas: {} })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText('Staging')).toBeInTheDocument()
    expect(screen.getByText('Development')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search...'), 'prod')

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.queryByText('Staging')).not.toBeInTheDocument()
    expect(screen.queryByText('Development')).not.toBeInTheDocument()
  })

  it('shows no databases message when search has no matches', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    await user.type(screen.getByPlaceholderText('Search...'), 'nonexistent')

    expect(screen.getByText('No databases found.')).toBeInTheDocument()
  })

  it('expands database when clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.queryByText('users')).not.toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('shows tables when database is expanded', () => {
    const store = createTestStore({
      expandedDatabases: { 'db-123': true }
    })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('expands table when clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore({
      expandedDatabases: { 'db-123': true }
    })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.queryByText('id (integer)')).not.toBeInTheDocument()

    await user.click(screen.getByText('users'))

    expect(screen.getByText('id (integer)')).toBeInTheDocument()
    expect(screen.getByText('name (varchar)')).toBeInTheDocument()
  })

  it('shows columns when table is expanded', () => {
    const store = createTestStore({
      expandedDatabases: { 'db-123': true },
      expandedTables: { 'db-123-users': true }
    })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('id (integer)')).toBeInTheDocument()
    expect(screen.getByText('name (varchar)')).toBeInTheDocument()
  })

  it('collapses database when clicked again', async () => {
    const user = userEvent.setup()
    const store = createTestStore({
      expandedDatabases: { 'db-123': true }
    })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('collapses table when clicked again', async () => {
    const user = userEvent.setup()
    const store = createTestStore({
      expandedDatabases: { 'db-123': true },
      expandedTables: { 'db-123-users': true }
    })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('id (integer)')).toBeInTheDocument()

    await user.click(screen.getByText('users'))

    expect(screen.queryByText('id (integer)')).not.toBeInTheDocument()
  })

  it('renders the add database button', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    const buttons = screen.getAllByRole('button')
    const addButton = buttons.find((button) =>
      button.querySelector('svg.lucide-plus')
    )

    expect(addButton).toBeInTheDocument()
  })

  it('opens create database screen when add button is clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    const buttons = screen.getAllByRole('button')
    const addButton = buttons.find((button) =>
      button.querySelector('svg.lucide-plus')
    )

    expect(addButton).toBeDefined()

    await user.click(addButton as HTMLElement)

    expect(store.getState().ui.editorScreen).toEqual({
      type: 'create-database'
    })
  })

  it('shows "Add a database" link in empty state', () => {
    const store = createTestStore({ databases: [] })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Add a database')).toBeInTheDocument()
  })

  it('opens create database screen when "Add a database" link is clicked', async () => {
    const user = userEvent.setup()
    const store = createTestStore({ databases: [] })

    render(
      <TestEnvironment store={store}>
        <DatabaseExplorer />
      </TestEnvironment>
    )

    await user.click(screen.getByText('Add a database'))

    expect(store.getState().ui.editorScreen).toEqual({
      type: 'create-database'
    })
  })
})
