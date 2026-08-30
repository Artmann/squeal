import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SchemaInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { DatabaseExplorer } from './DatabaseExplorer'

vi.mock('../api-client', () => ({
  apiClient: {
    createQuery: vi.fn(),
    createWorksheet: vi.fn(),
    deleteDatabase: vi.fn(),
    getDatabaseSchema: vi.fn(),
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

// Two schemas, so the table has to be qualified for the query to find it.
const multiSchemaSchema: SchemaInfo = {
  databaseName: 'testdb',
  tables: [
    { ...testSchema.tables[0], tableSchema: 'public' },
    { ...testSchema.tables[1], tableSchema: 'billing' }
  ]
}

describe('DatabaseExplorer', () => {
  // Several tests below assert that no schema was requested, and the mock is
  // shared across the file.
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
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
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
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
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
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
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
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
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('reveals only the tables a search matched', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    await user.type(screen.getByPlaceholderText('Filter tables'), 'user')

    // The match is what forces the row open, so what it opens onto is the
    // matching tables — not the whole list with the answer somewhere in it.
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.queryByText('posts')).not.toBeInTheDocument()
  })

  it('shows each database its own tables', async () => {
    const user = userEvent.setup()
    const otherSchema: SchemaInfo = {
      databaseName: 'otherdb',
      tables: [{ ...testSchema.tables[0], tableName: 'invoices' }]
    }

    renderWithProviders(<DatabaseExplorer />, {
      databases: [
        testDatabase,
        { ...testDatabase, id: 'db-999', name: 'Other Database' }
      ],
      schemas: { 'db-123': testSchema, 'db-999': otherSchema }
    })

    await user.click(screen.getByText('Other Database'))

    // The rows read their schemas by position in an array built from a second
    // pass over the same databases. That is correct only while the two passes
    // stay in step, and nothing about it is checked by types: a filter or sort
    // added to one of them would quietly file one database's tables under
    // another's name.
    expect(screen.getByText('invoices')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('collapses a database the search forced open', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    // "users" matches, so the row is forced open by the search.
    await user.type(screen.getByPlaceholderText('Filter tables'), 'user')

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()
  })

  it('keeps a database expanded after the search is cleared', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    const searchInput = screen.getByPlaceholderText('Filter tables')

    // Only the name matches "test", so the search proposes a collapsed row and
    // expanding it is the user's own decision.
    await user.type(searchInput, 'test')
    await user.click(screen.getByText('Test Database'))

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.clear(searchInput)

    // Back to the unfiltered tree, their decision is still the latest thing
    // they said about this database.
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('keeps a database collapsed after the search is cleared', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    const searchInput = screen.getByPlaceholderText('Filter tables')

    await user.type(searchInput, 'user')
    await user.click(screen.getByText('Test Database'))
    await user.clear(searchInput)

    expect(screen.getByText('Test Database')).toBeInTheDocument()
    expect(screen.queryByText('users')).not.toBeInTheDocument()
    expect(screen.queryByText('posts')).not.toBeInTheDocument()
  })

  it('lets a search expand a database the user collapsed while browsing', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    // The ordinary browsing loop: expand a database, look at it, close it
    // again. No search is involved, so this says nothing about any query.
    await user.click(screen.getByText('Test Database'))

    expect(screen.getByText('users')).toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Filter tables'), 'user')

    expect(screen.getByText('users')).toBeInTheDocument()
  })

  it('follows a new query after collapsing a row the previous one forced open', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    const searchInput = screen.getByPlaceholderText('Filter tables')

    await user.type(searchInput, 'user')
    await user.click(screen.getByText('Test Database'))

    expect(screen.queryByText('users')).not.toBeInTheDocument()

    // A different query is a different question, so the collapse that answered
    // the last one has nothing to say about this one.
    await user.clear(searchInput)
    await user.type(searchInput, 'post')

    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('keeps a manually expanded database open when only its name matches', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    await user.click(screen.getByText('Test Database'))

    expect(screen.getByText('users')).toBeInTheDocument()

    // Only the database name matches "test", so the query said nothing about
    // this database's tables. That is the absence of an instruction, not an
    // instruction to hide a row the user opened themselves — and the match
    // keeps the full table list precisely so it can still be shown.
    await user.type(screen.getByPlaceholderText('Filter tables'), 'test')

    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('keeps a database the user expanded during this query open', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    // No table is named after "test", so only the database name matches and
    // the search proposes a collapsed row.
    await user.type(screen.getByPlaceholderText('Filter tables'), 'test')

    expect(screen.queryByText('users')).not.toBeInTheDocument()

    await user.click(screen.getByText('Test Database'))

    // Expanding answers this query, so the whole table list stays revealed.
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('posts')).toBeInTheDocument()
  })

  it('reports expansion to assistive technology', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    const header = screen.getByRole('button', { name: 'Test Database' })

    expect(header).toHaveAttribute('aria-expanded', 'false')

    await user.click(header)

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'users' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('reports a search-forced expansion to assistive technology', async () => {
    const user = userEvent.setup()

    renderWithProviders(<DatabaseExplorer />, {
      databases: [testDatabase],
      schemas: { 'db-123': testSchema }
    })

    await user.type(screen.getByPlaceholderText('Filter tables'), 'user')

    // The chevron rotation is a visual-only cue, so a row the search opened
    // has to announce itself as open too.
    expect(
      screen.getByRole('button', { name: 'Test Database' })
    ).toHaveAttribute('aria-expanded', 'true')
  })

  describe('a connection whose stored details cannot be read', () => {
    const unreadableDatabase: DatabaseDto = {
      ...testDatabase,
      connectionInfo: null,
      id: 'db-unreadable',
      name: 'Broken Connection'
    }

    // One line, not a sentence per row: with several broken connections a
    // paragraph each buries the list it describes, so the row carries a short
    // action and the marker's tooltip carries the explanation.
    it('marks the row and asks for nothing it cannot get', () => {
      renderWithProviders(<DatabaseExplorer />, {
        databases: [unreadableDatabase]
      })

      expect(screen.getByText('Re-enter details')).toBeInTheDocument()

      expect(
        screen.getByRole('img', {
          name: "Squeal can't read this connection's saved details. Re-enter them to repair it."
        })
      ).toBeInTheDocument()

      // The list already said the secret is unreadable, so the schema request
      // would only fail for a reason that is already known.
      expect(apiClient.getDatabaseSchema).not.toHaveBeenCalled()
    })

    it('keeps the whole row to a single line', () => {
      renderWithProviders(<DatabaseExplorer />, {
        databases: [unreadableDatabase]
      })

      // The sentence lives in the tooltip, so it must not also be on screen.
      expect(screen.queryByText(/Squeal can't read/)).not.toBeInTheDocument()
    })

    it('opens the connection form when the row is clicked', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<DatabaseExplorer />, {
        databases: [unreadableDatabase]
      })

      await user.click(screen.getByText('Broken Connection'))

      expect(store.getState().ui.editorScreen).toEqual({
        databaseId: 'db-unreadable',
        type: 'edit-database'
      })
    })

    it('still asks for the schemas of the connections it can read', () => {
      renderWithProviders(<DatabaseExplorer />, {
        databases: [unreadableDatabase, testDatabase]
      })

      expect(apiClient.getDatabaseSchema).toHaveBeenCalledTimes(1)
      expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-123')
    })
  })

  describe('a schema that will not load', () => {
    const failureMessage =
      'Failed to load schema for "Test Database": connection refused'

    const expandedOptions = {
      databaseExplorer: {
        expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
      },
      databases: [testDatabase]
    }

    it('gives the reason instead of an empty tree', async () => {
      vi.mocked(apiClient.getDatabaseSchema).mockRejectedValue(
        new Error(failureMessage)
      )

      renderWithProviders(<DatabaseExplorer />, expandedOptions)

      expect(await screen.findByText(failureMessage)).toBeInTheDocument()

      // Marked on the row as well, so a collapsed one is not silent.
      expect(
        screen.getByRole('img', { name: failureMessage })
      ).toBeInTheDocument()
    })

    it('asks again when the retry is taken', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.getDatabaseSchema).mockRejectedValue(
        new Error(failureMessage)
      )

      renderWithProviders(<DatabaseExplorer />, expandedOptions)

      await user.click(await screen.findByRole('button', { name: 'Retry' }))

      await waitFor(() => {
        expect(apiClient.getDatabaseSchema).toHaveBeenCalledTimes(2)
      })
    })
  })

  describe('querying a table from the context menu', () => {
    const createdWorksheet: WorksheetDto = {
      content: 'SELECT * FROM "users" LIMIT 100',
      createdAt: 1704067200000,
      databaseId: 'db-123',
      id: 'ws-users',
      lastOpenedAt: null,
      name: 'users',
      sortOrder: null
    }

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(apiClient.createWorksheet).mockResolvedValue(createdWorksheet)
      vi.mocked(apiClient.createQuery).mockResolvedValue({
        query: {
          content: 'SELECT * FROM "users" LIMIT 100',
          databaseId: 'db-123',
          error: null,
          finishedAt: null,
          id: 'q-1',
          queriedAt: 1704067200000,
          result: null,
          worksheetId: 'ws-users'
        }
      })
    })

    // `AppShell` starts every collection in the real app. Nothing here
    // subscribes to `queries`, so the insert handler's write-back would fail
    // without this.
    async function renderExplorer(schema: SchemaInfo = testSchema) {
      const rendered = renderWithProviders(<DatabaseExplorer />, {
        databaseExplorer: {
          expandedDatabases: { 'db-123': { isExpanded: true, query: '' } }
        },
        databases: [testDatabase],
        schemas: { 'db-123': schema },
        queries: [],
        worksheets: []
      })

      await act(async () => {
        await rendered.collections.queries.preload()
      })

      return rendered
    }

    it('creates a worksheet with a select query', async () => {
      const user = userEvent.setup()

      const { store } = await renderExplorer()

      fireEvent.contextMenu(screen.getByText('users'))

      await user.click(await screen.findByText('Query Table'))

      await waitFor(() => {
        expect(apiClient.createWorksheet).toHaveBeenCalledWith({
          content: 'SELECT * FROM "users" LIMIT 100',
          databaseId: 'db-123',
          name: 'users'
        })
      })

      await waitFor(() => {
        expect(store.getState().tabs.activeWorksheetId).toEqual('ws-users')
      })
    })

    it('runs the query as soon as the worksheet exists', async () => {
      const user = userEvent.setup()

      await renderExplorer()

      fireEvent.contextMenu(screen.getByText('users'))

      await user.click(await screen.findByText('Query Table'))

      await waitFor(() => {
        expect(apiClient.createQuery).toHaveBeenCalledWith(
          {
            content: 'SELECT * FROM "users" LIMIT 100',
            databaseId: 'db-123',
            id: expect.any(String),
            queriedAt: expect.any(Number),
            worksheetId: 'ws-users'
          },
          expect.anything()
        )
      })
    })

    it('qualifies the table when the database spans several schemas', async () => {
      const user = userEvent.setup()

      await renderExplorer(multiSchemaSchema)

      fireEvent.contextMenu(screen.getByText('users'))

      await user.click(await screen.findByText('Query Table'))

      await waitFor(() => {
        expect(apiClient.createWorksheet).toHaveBeenCalledWith({
          content: 'SELECT * FROM "public"."users" LIMIT 100',
          databaseId: 'db-123',
          name: 'users'
        })
      })

      await waitFor(() => {
        expect(apiClient.createQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            content: 'SELECT * FROM "public"."users" LIMIT 100'
          }),
          expect.anything()
        )
      })
    })

    it('runs nothing when the worksheet cannot be created', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.createWorksheet).mockRejectedValue(
        new Error('Disk is full')
      )

      await renderExplorer()

      fireEvent.contextMenu(screen.getByText('users'))

      await user.click(await screen.findByText('Query Table'))

      expect(
        await screen.findByText('Failed to create worksheet')
      ).toBeVisible()
      expect(apiClient.createQuery).not.toHaveBeenCalled()
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

  describe('refreshing', () => {
    const firstDatabase = { ...testDatabase, id: 'db-1', name: 'Production' }
    const secondDatabase = { ...testDatabase, id: 'db-2', name: 'Staging' }
    const bothDatabases = [firstDatabase, secondDatabase]

    // Seeded caches are never stale (staleTime: Infinity), so nothing is
    // fetched before the refresh and every recorded call belongs to it.
    const seededOptions = {
      databases: bothDatabases,
      schemas: { 'db-1': testSchema, 'db-2': testSchema }
    }

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(apiClient.getDatabases).mockResolvedValue(bothDatabases)
      vi.mocked(apiClient.getDatabaseSchema).mockResolvedValue(testSchema)
    })

    it('has no refresh button while there are no databases', () => {
      renderWithProviders(<DatabaseExplorer />, { databases: [] })

      expect(
        screen.queryByRole('button', { name: 'Refresh databases' })
      ).not.toBeInTheDocument()
    })

    it('reloads the connection list and every schema from the header button', async () => {
      const user = userEvent.setup()

      renderWithProviders(<DatabaseExplorer />, seededOptions)

      await user.click(
        screen.getByRole('button', { name: 'Refresh databases' })
      )

      await waitFor(() => {
        expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-1')
      })

      expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-2')
      expect(apiClient.getDatabases).toHaveBeenCalled()
    })

    it('reloads every schema from the keyboard shortcut', async () => {
      renderWithProviders(<DatabaseExplorer />, seededOptions)

      // The matcher reads event.code, and `mod` accepts either meta or ctrl.
      // No `altKey`: this was Mod-Alt-R only for as long as Electron's default
      // menu owned Mod-R for Reload, which `src/main/menu.ts` now leaves out.
      fireEvent.keyDown(document, {
        code: 'KeyR',
        key: 'r',
        metaKey: true
      })

      await waitFor(() => {
        expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-1')
      })

      expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-2')
    })

    it('reloads one schema from the row context menu', async () => {
      const user = userEvent.setup()

      renderWithProviders(<DatabaseExplorer />, seededOptions)

      fireEvent.contextMenu(screen.getByText('Staging'))

      await user.click(await screen.findByRole('menuitem', { name: 'Refresh' }))

      await waitFor(() => {
        expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('db-2')
      })

      expect(apiClient.getDatabaseSchema).not.toHaveBeenCalledWith('db-1')
    })

    it('reports a refresh that failed', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.getDatabaseSchema).mockRejectedValue(
        new Error('Failed to load schema for "Staging": connection refused')
      )

      renderWithProviders(<DatabaseExplorer />, seededOptions)

      await user.click(
        screen.getByRole('button', { name: 'Refresh databases' })
      )

      expect(
        await screen.findByText('Failed to refresh databases')
      ).toBeVisible()
      expect(
        await screen.findByText(
          'Failed to load schema for "Staging": connection refused'
        )
      ).toBeVisible()
    })

    it('names the database when a single-connection refresh fails', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.getDatabaseSchema).mockRejectedValue(
        new Error('Failed to load schema for "Staging": connection refused')
      )

      renderWithProviders(<DatabaseExplorer />, seededOptions)

      fireEvent.contextMenu(screen.getByText('Staging'))

      await user.click(await screen.findByRole('menuitem', { name: 'Refresh' }))

      expect(
        await screen.findByText('Failed to refresh "Staging"')
      ).toBeVisible()
    })
  })
})
