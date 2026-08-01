import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { DatabaseExplorer } from './DatabaseExplorer'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
    deleteDatabase: vi.fn(),
    getDatabases: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getWorksheets: vi.fn(async () => []),
    updateWorksheet: vi.fn()
  }
}))

import { apiClient } from '../api-client'

// Radix UI primitives use DOM APIs not available in jsdom.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof window.ResizeObserver
})

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'testdb',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  id: 'db-123',
  name: 'Test Database',
  sortOrder: null,
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

describe('DatabaseExplorer', () => {
  it('renders the header and search input', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    expect(screen.getByText('Databases')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Filter tables')).toBeInTheDocument()
  })

  it('renders database names', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    expect(screen.getByText('Test Database')).toBeInTheDocument()
  })

  it('shows a message when there are no databases', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [] })

    expect(
      screen.getByText(
        'Connect a database to browse its tables and columns here.'
      )
    ).toBeInTheDocument()
  })

  it('filters databases by the search query', async () => {
    const user = userEvent.setup()
    const databases = [
      { ...testDatabase, id: 'db-1', name: 'Production' },
      { ...testDatabase, id: 'db-2', name: 'Staging' },
      { ...testDatabase, id: 'db-3', name: 'Development' }
    ]

    renderWithProviders(<DatabaseExplorer />, { databases })

    await user.type(screen.getByPlaceholderText('Filter tables'), 'prod')

    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.queryByText('Staging')).not.toBeInTheDocument()
    expect(screen.queryByText('Development')).not.toBeInTheDocument()
  })

  it('expands a database when clicked to reveal its tables', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.queryByText('users')).not.toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('shows tables when a database is already expanded', () => {
    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()

    // A single-schema database stays free of schema badges.
    expect(screen.queryByText('public')).not.toBeInTheDocument()
  })

  it('expands a table when clicked to reveal its columns', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.queryByText('integer')).not.toBeInTheDocument()

    await user.click(screen.getByText('users'))

    // The column line splits into a name and a right-aligned type.
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('integer')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
    expect(screen.getByText('varchar')).toBeInTheDocument()
  })

  it('renders a schema badge when a database spans several schemas', () => {
    const multiSchemaTables = [
      testSchema.tables[0],
      { ...testSchema.tables[1], tableSchema: 'reporting' }
    ]

    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: {
        'db-123': { ...testSchema, tables: multiSchemaTables }
      }
    })

    expect(screen.getByText('public')).toBeInTheDocument()
    expect(screen.getByText('reporting')).toBeInTheDocument()
  })

  it('keeps same-named tables from different schemas independent', async () => {
    const user = userEvent.setup()
    const duplicatedTables = [
      testSchema.tables[0],
      { ...testSchema.tables[0], tableSchema: 'reporting' }
    ]

    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: {
        'db-123': { ...testSchema, tables: duplicatedTables }
      }
    })

    const tableRows = screen.getAllByText('users')

    expect(tableRows).toHaveLength(2)

    await user.click(tableRows[0])

    // Only the expanded row reveals its columns — the keys carry the schema.
    expect(screen.getAllByText('integer')).toHaveLength(1)
  })

  it('collapses an expanded database when clicked again', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('creates a worksheet with a select query from the table context menu', async () => {
    const user = userEvent.setup()
    const createdWorksheet: WorksheetDto = {
      content: 'SELECT * FROM users LIMIT 100',
      createdAt: 1704067200000,
      databaseId: 'db-123',
      id: 'ws-users',
      lastOpenedAt: null,
      name: 'users',
      sortOrder: null
    }

    vi.mocked(apiClient.createWorksheet).mockResolvedValue(createdWorksheet)

    const { store } = renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema },
      worksheets: []
    })

    fireEvent.contextMenu(screen.getByText('users'))

    await user.click(await screen.findByText('Query Table'))

    await waitFor(() => {
      expect(apiClient.createWorksheet).toHaveBeenCalledWith({
        content: 'SELECT * FROM users LIMIT 100',
        databaseId: 'db-123',
        name: 'users'
      })
    })

    await waitFor(() => {
      expect(store.getState().tabs.activeWorksheetId).toEqual('ws-users')
    })
  })

  it('deletes a database after confirming via the action toast', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.deleteDatabase).mockResolvedValue(undefined)

    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    fireEvent.contextMenu(screen.getByText('Test Database'))

    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    // The action toast asks for confirmation before anything is deleted.
    expect(apiClient.deleteDatabase).not.toHaveBeenCalled()
    expect(await screen.findByText('Delete "Test Database"?')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(apiClient.deleteDatabase).toHaveBeenCalledWith('db-123')
    })
  })

  it('does not delete when the confirmation toast is ignored', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.deleteDatabase).mockClear()

    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    fireEvent.contextMenu(screen.getByText('Test Database'))

    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(await screen.findByText('Delete "Test Database"?')).toBeVisible()
    expect(apiClient.deleteDatabase).not.toHaveBeenCalled()
  })

  it('opens the create database screen from the add button', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase]
    })

    const addButton = screen
      .getAllByRole('button')
      .find((button) => button.querySelector('svg.lucide-plus'))

    expect(addButton).toBeDefined()

    await user.click(addButton as HTMLElement)

    expect(store.getState().ui.editorScreen).toEqual({
      type: 'create-database'
    })
  })

  it('opens the create database screen from the empty-state link', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<DatabaseExplorer />, {
      databases: []
    })

    await user.click(screen.getByText('Add a database'))

    expect(store.getState().ui.editorScreen).toEqual({
      type: 'create-database'
    })
  })
})
