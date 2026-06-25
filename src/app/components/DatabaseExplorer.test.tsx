import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'

import { renderWithProviders } from '../test-utils'
import { DatabaseExplorer } from './DatabaseExplorer'

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

describe('DatabaseExplorer', () => {
  it('renders the header and search input', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    expect(screen.getByText('Database Explorer')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('renders database names', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [testDatabase] })

    expect(screen.getByText('Test Database')).toBeInTheDocument()
  })

  it('shows a message when there are no databases', () => {
    renderWithProviders(<DatabaseExplorer />, { databases: [] })

    expect(screen.getByText('No databases found.')).toBeInTheDocument()
  })

  it('filters databases by the search query', async () => {
    const user = userEvent.setup()
    const databases = [
      { ...testDatabase, id: 'db-1', name: 'Production' },
      { ...testDatabase, id: 'db-2', name: 'Staging' },
      { ...testDatabase, id: 'db-3', name: 'Development' }
    ]

    renderWithProviders(<DatabaseExplorer />, { databases })

    await user.type(screen.getByPlaceholderText('Search...'), 'prod')

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
  })

  it('expands a table when clicked to reveal its columns', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databaseExplorer: { expandedDatabases: { 'db-123': true } },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.queryByText('id (integer)')).not.toBeInTheDocument()

    await user.click(screen.getByText('users'))

    expect(screen.getByText('id (integer)')).toBeInTheDocument()
    expect(screen.getByText('name (varchar)')).toBeInTheDocument()
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
