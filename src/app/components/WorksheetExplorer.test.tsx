import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { WorksheetExplorer } from './WorksheetExplorer'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
    deleteWorksheet: vi.fn(),
    getDatabases: vi.fn(async () => []),
    updateWorksheet: vi.fn()
  }
}))

import { apiClient } from '../api-client'

// Radix's tooltip positioning needs DOM APIs jsdom does not ship.
beforeAll(() => {
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof window.ResizeObserver
})

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'pagila',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  environmentId: null,
  id: 'db-123',
  name: 'Pagila',
  sortOrder: null,
  type: 'postgres'
}

const testWorksheet: WorksheetDto = {
  content: 'SELECT * FROM users',
  createdAt: 1704067200000,
  databaseId: null,
  id: 'ws-123',
  lastOpenedAt: null,
  name: 'Test Worksheet',
  sortOrder: null
}

const secondWorksheet: WorksheetDto = {
  content: '',
  createdAt: 1704067300000,
  databaseId: null,
  id: 'ws-456',
  lastOpenedAt: null,
  name: 'Second Worksheet',
  sortOrder: null
}

describe('WorksheetExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(testWorksheet)
  })

  it('renders the header', () => {
    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      worksheets: [testWorksheet]
    })

    expect(screen.getByText('Worksheets')).toBeInTheDocument()
  })

  it('explains the add button in a tooltip', async () => {
    const user = userEvent.setup()

    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      worksheets: [testWorksheet]
    })

    await user.hover(screen.getByRole('button', { name: 'New worksheet' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'New worksheet'
    )
  })

  it('renders worksheet names', () => {
    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      worksheets: [testWorksheet]
    })

    expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
  })

  describe('filter', () => {
    it('brings every worksheet back when the filter is cleared', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      await user.type(
        screen.getByPlaceholderText('Filter worksheets'),
        'Second'
      )

      expect(screen.queryByText('Test Worksheet')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear search' }))

      expect(screen.getByPlaceholderText('Filter worksheets')).toHaveValue('')
      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
    })

    it('clears the filter on Escape', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      await user.type(
        screen.getByPlaceholderText('Filter worksheets'),
        'Second{Escape}'
      )

      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
      expect(screen.getByText('Second Worksheet')).toBeInTheDocument()
    })
  })

  it('marks the active worksheet as current', () => {
    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      tabs: { activeWorksheetId: 'ws-456', openWorksheetIds: ['ws-456'] },
      worksheets: [testWorksheet, secondWorksheet]
    })

    expect(
      screen.getByRole('button', { name: 'Second Worksheet' })
    ).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByRole('button', { name: 'Test Worksheet' })
    ).not.toHaveAttribute('aria-current')
  })

  describe('database badge', () => {
    it('names the database a worksheet runs against', () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [testDatabase],
        worksheets: [{ ...testWorksheet, databaseId: 'db-123' }]
      })

      expect(screen.getByText('Pagila')).toBeInTheDocument()
    })

    it('renders nothing when the worksheet has no database', () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [testDatabase],
        worksheets: [testWorksheet]
      })

      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
      expect(screen.queryByText('Pagila')).not.toBeInTheDocument()
    })

    it('renders nothing when the database is gone', () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [{ ...testWorksheet, databaseId: 'db-removed' }]
      })

      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
      expect(screen.queryByText('db-removed')).not.toBeInTheDocument()
    })
  })

  it('selects a worksheet on single click', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      worksheets: [testWorksheet]
    })

    await user.click(screen.getByText('Test Worksheet'))

    expect(store.getState().tabs.activeWorksheetId).toEqual('ws-123')
  })

  it('persists the last-opened time when a worksheet is selected', async () => {
    const user = userEvent.setup()

    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      openWorksheetId: 'ws-123',
      worksheets: [testWorksheet, secondWorksheet]
    })

    await user.click(screen.getByText('Second Worksheet'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-456', {
        lastOpenedAt: expect.any(Number)
      })
    })
  })

  // The tab is already open by the time the PATCH is sent, and what it costs is
  // the MRU order. Rejecting the promise unhandled would surface as a
  // `renderer.error` trace for something the user never asked for.
  it('opens the worksheet anyway when recording the time fails', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateWorksheet).mockRejectedValue(
      new Error('Database is locked')
    )

    const { store } = renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      openWorksheetId: 'ws-123',
      worksheets: [testWorksheet, secondWorksheet]
    })

    await user.click(screen.getByText('Second Worksheet'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-456', {
        lastOpenedAt: expect.any(Number)
      })
    })

    expect({
      activeWorksheetId: store.getState().tabs.activeWorksheetId,
      alerts: screen.queryAllByRole('alert').map((alert) => alert.textContent)
    }).toEqual({ activeWorksheetId: 'ws-456', alerts: [] })
  })

  describe('rename', () => {
    it('enters edit mode on double click', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      expect(input).toBeInTheDocument()
      expect(input.tagName).toEqual('INPUT')
    })

    it('saves the new name on Enter', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.clear(input)
      await user.type(input, 'Renamed Worksheet{Enter}')

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
          name: 'Renamed Worksheet'
        })
      })
    })

    it('cancels editing on Escape', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.clear(input)
      await user.type(input, 'New Name{Escape}')

      expect(screen.queryByDisplayValue('New Name')).not.toBeInTheDocument()
      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
    })

    it('saves the new name on blur', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.clear(input)
      await user.type(input, 'Blurred Name')
      await user.tab()

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
          name: 'Blurred Name'
        })
      })
    })

    it('does not save an empty name', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.clear(input)
      await user.type(input, '{Enter}')

      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
      expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
    })

    it('does not save an unchanged name', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.type(input, '{Enter}')

      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
    })

    it('can rename a newly created worksheet using its real id', async () => {
      const user = userEvent.setup()

      const createdWorksheet: WorksheetDto = {
        content: '',
        createdAt: 1704067200000,
        databaseId: null,
        id: 'real-db-id',
        lastOpenedAt: null,
        name: 'Worksheet draft',
        sortOrder: null
      }

      vi.mocked(apiClient.createWorksheet).mockResolvedValue(createdWorksheet)

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: []
      })

      const addButton = screen
        .getAllByRole('button')
        .find((button) => button.querySelector('svg.lucide-plus'))

      await user.click(addButton as HTMLElement)

      await waitFor(() => {
        expect(apiClient.createWorksheet).toHaveBeenCalled()
      })

      const input = await screen.findByDisplayValue('Worksheet draft')

      await user.clear(input)
      await user.type(input, 'My New Worksheet{Enter}')

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('real-db-id', {
          name: 'My New Worksheet'
        })
      })
    })
  })
  describe('deleting', () => {
    const secondWorksheet: WorksheetDto = {
      ...testWorksheet,
      id: 'ws-456',
      name: 'Second Worksheet'
    }

    it('deletes a worksheet after confirming in the dialog', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.deleteWorksheet).mockResolvedValue(undefined)

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Second Worksheet'))

      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

      // The dialog asks first; nothing is deleted until it is confirmed.
      expect(apiClient.deleteWorksheet).not.toHaveBeenCalled()
      expect(await screen.findByRole('alertdialog')).toHaveTextContent(
        'Delete "Second Worksheet"?'
      )

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(apiClient.deleteWorksheet).toHaveBeenCalledWith('ws-456')
      })
    })

    it('does not delete when the confirmation is cancelled', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Second Worksheet'))

      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

      expect(await screen.findByRole('alertdialog')).toHaveTextContent(
        'Delete "Second Worksheet"?'
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).toBeNull()
      })

      expect(apiClient.deleteWorksheet).not.toHaveBeenCalled()
    })

    // The app is built around always having a worksheet open, and the list
    // endpoint would just recreate a default one.
    it('disables delete for the last remaining worksheet', async () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Test Worksheet'))

      expect(
        await screen.findByRole('menuitem', { name: 'Delete' })
      ).toHaveAttribute('aria-disabled', 'true')
    })

    it('offers Rename in the same menu', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Second Worksheet'))

      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

      expect(await screen.findByDisplayValue('Second Worksheet')).toBeVisible()
    })
  })

  describe('duplicating', () => {
    const connectedWorksheet: WorksheetDto = {
      ...testWorksheet,
      databaseId: 'db-123'
    }

    const copiedWorksheet: WorksheetDto = {
      ...connectedWorksheet,
      id: 'ws-copy',
      name: 'Test Worksheet copy'
    }

    it('creates a copy with the same content and database, and opens it', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.createWorksheet).mockResolvedValue(copiedWorksheet)

      const { store } = renderWithProviders(<WorksheetExplorer />, {
        databases: [testDatabase],
        openWorksheetId: 'ws-123',
        worksheets: [connectedWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Test Worksheet'))

      await user.click(
        await screen.findByRole('menuitem', { name: 'Duplicate' })
      )

      await waitFor(() => {
        expect(store.getState().tabs).toEqual({
          activeWorksheetId: 'ws-copy',
          openWorksheetIds: ['ws-123', 'ws-copy'],
          status: 'reconciled'
        })
      })

      expect(apiClient.createWorksheet).toHaveBeenCalledWith({
        content: 'SELECT * FROM users',
        databaseId: 'db-123',
        name: 'Test Worksheet copy'
      })
      expect(await screen.findByText('Test Worksheet copy')).toBeVisible()
    })

    it('numbers the copy when the name is taken', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.createWorksheet).mockResolvedValue({
        ...copiedWorksheet,
        id: 'ws-copy-2',
        name: 'Test Worksheet copy 2'
      })

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, { ...copiedWorksheet, databaseId: null }]
      })

      fireEvent.contextMenu(screen.getByText('Test Worksheet'))

      await user.click(
        await screen.findByRole('menuitem', { name: 'Duplicate' })
      )

      await waitFor(() => {
        expect(apiClient.createWorksheet).toHaveBeenCalledWith({
          content: 'SELECT * FROM users',
          name: 'Test Worksheet copy 2'
        })
      })
    })

    it('says so when the copy cannot be saved', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.createWorksheet).mockRejectedValue(
        new Error('Database is locked')
      )

      const { store } = renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: [testWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Test Worksheet'))

      await user.click(
        await screen.findByRole('menuitem', { name: 'Duplicate' })
      )

      expect(
        await screen.findByText('Failed to duplicate worksheet')
      ).toBeVisible()
      expect(await screen.findByText('Database is locked')).toBeVisible()
      expect(store.getState().tabs.activeWorksheetId).toEqual('ws-123')
    })
  })
  describe('selecting several worksheets', () => {
    // Explicit sort orders, so the rows sit in the order the tests name them:
    // the list falls back to newest-first for worksheets without one.
    const threeWorksheets: WorksheetDto[] = [
      { ...testWorksheet, sortOrder: 0 },
      { ...secondWorksheet, sortOrder: 1 },
      { ...testWorksheet, id: 'ws-789', name: 'Third Worksheet', sortOrder: 2 }
    ]

    // What the sidebar acts on together, read off the rows rather than the
    // store: the highlight is the only thing telling the user what a drag or a
    // delete is about to take with it.
    function selectedNames(): string[] {
      return screen
        .getAllByRole('button')
        .filter((button) => button.dataset.selected === 'true')
        .map((button) => button.textContent ?? '')
    }

    it('adds a row to the selection on a command-click, without opening it', () => {
      const { store } = renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: threeWorksheets
      })

      fireEvent.click(
        screen.getByRole('button', { name: 'Second Worksheet' }),
        {
          metaKey: true
        }
      )

      // The open worksheet joins the selection it started: a command-click adds
      // a row, so it cannot be the thing that drops the row you were on.
      expect({
        openWorksheetId: store.getState().tabs.activeWorksheetId,
        selected: selectedNames()
      }).toEqual({
        openWorksheetId: 'ws-123',
        selected: ['Test Worksheet', 'Second Worksheet']
      })
    })

    // `mod` is ⌘ on macOS and Ctrl everywhere else, and the click handler is
    // the one place in the sidebar that has to know both.
    it('adds a row on a control-click too', () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: threeWorksheets
      })

      fireEvent.click(
        screen.getByRole('button', { name: 'Second Worksheet' }),
        {
          ctrlKey: true
        }
      )

      expect(selectedNames()).toEqual(['Test Worksheet', 'Second Worksheet'])
    })

    it('takes a selected row back out on a second command-click', () => {
      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: threeWorksheets
      })

      const row = screen.getByRole('button', { name: 'Second Worksheet' })

      fireEvent.click(row, { metaKey: true })
      fireEvent.click(row, { metaKey: true })

      expect(selectedNames()).toEqual(['Test Worksheet'])
    })

    it('selects the range from the open row on a shift-click', () => {
      const { store } = renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: threeWorksheets
      })

      fireEvent.click(screen.getByRole('button', { name: 'Third Worksheet' }), {
        shiftKey: true
      })

      expect({
        openWorksheetId: store.getState().tabs.activeWorksheetId,
        selected: selectedNames()
      }).toEqual({
        openWorksheetId: 'ws-123',
        selected: ['Test Worksheet', 'Second Worksheet', 'Third Worksheet']
      })
    })

    it('drops the selection and opens the worksheet on a plain click', () => {
      const { store } = renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        openWorksheetId: 'ws-123',
        worksheets: threeWorksheets
      })

      fireEvent.click(screen.getByRole('button', { name: 'Third Worksheet' }), {
        shiftKey: true
      })
      fireEvent.click(screen.getByRole('button', { name: 'Second Worksheet' }))

      expect({
        openWorksheetId: store.getState().tabs.activeWorksheetId,
        selected: selectedNames()
      }).toEqual({
        openWorksheetId: 'ws-456',
        selected: ['Second Worksheet']
      })
    })

    describe('deleting the selection', () => {
      const selectingTwo = {
        worksheetSelection: { anchorId: 'ws-123', ids: ['ws-123', 'ws-456'] }
      }

      it('deletes every selected worksheet after one confirmation', async () => {
        const user = userEvent.setup()

        vi.mocked(apiClient.deleteWorksheet).mockResolvedValue(undefined)

        renderWithProviders(<WorksheetExplorer />, {
          databases: [],
          editor: selectingTwo,
          openWorksheetId: 'ws-123',
          worksheets: threeWorksheets
        })

        fireEvent.contextMenu(screen.getByText('Second Worksheet'))

        await user.click(
          await screen.findByRole('menuitem', { name: 'Delete 2 worksheets' })
        )

        expect(await screen.findByText('Delete 2 worksheets?')).toBeVisible()
        expect(apiClient.deleteWorksheet).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Delete' }))

        await waitFor(() => {
          expect(vi.mocked(apiClient.deleteWorksheet).mock.calls).toEqual([
            ['ws-123'],
            ['ws-456']
          ])
        })

        expect(await screen.findByText('Deleted 2 worksheets')).toBeVisible()
      })

      // Renaming three worksheets at once means nothing, so the menu does not
      // offer it rather than quietly renaming the one that was right-clicked.
      it('offers no rename or duplicate while several rows are selected', async () => {
        renderWithProviders(<WorksheetExplorer />, {
          databases: [],
          editor: selectingTwo,
          openWorksheetId: 'ws-123',
          worksheets: threeWorksheets
        })

        fireEvent.contextMenu(screen.getByText('Second Worksheet'))

        await screen.findByRole('menuitem', { name: 'Delete 2 worksheets' })

        expect(
          screen.queryByRole('menuitem', { name: 'Rename' })
        ).not.toBeInTheDocument()
        expect(
          screen.queryByRole('menuitem', { name: 'Duplicate' })
        ).not.toBeInTheDocument()
      })

      // Right-clicking outside the selection is how a file manager behaves:
      // the row you pointed at becomes the selection, and the menu acts on it.
      it('acts on the row alone when it is not part of the selection', async () => {
        const user = userEvent.setup()

        vi.mocked(apiClient.deleteWorksheet).mockResolvedValue(undefined)

        renderWithProviders(<WorksheetExplorer />, {
          databases: [],
          editor: selectingTwo,
          openWorksheetId: 'ws-123',
          worksheets: threeWorksheets
        })

        fireEvent.contextMenu(screen.getByText('Third Worksheet'))

        await user.click(
          await screen.findByRole('menuitem', { name: 'Delete' })
        )
        await user.click(await screen.findByRole('button', { name: 'Delete' }))

        await waitFor(() => {
          expect(vi.mocked(apiClient.deleteWorksheet).mock.calls).toEqual([
            ['ws-789']
          ])
        })
      })

      // Same rule as the single row: the app is built around always having a
      // worksheet open, and the list endpoint would recreate a default one.
      it('disables the delete that would empty the list', async () => {
        renderWithProviders(<WorksheetExplorer />, {
          databases: [],
          editor: selectingTwo,
          openWorksheetId: 'ws-123',
          worksheets: [testWorksheet, secondWorksheet]
        })

        fireEvent.contextMenu(screen.getByText('Second Worksheet'))

        expect(
          await screen.findByRole('menuitem', { name: 'Delete 2 worksheets' })
        ).toHaveAttribute('aria-disabled', 'true')
      })

      it('says how many of them failed when only some are deleted', async () => {
        const user = userEvent.setup()

        vi.mocked(apiClient.deleteWorksheet).mockImplementation(
          async (worksheetId: string) => {
            if (worksheetId === 'ws-456') {
              throw new Error('Database is locked')
            }
          }
        )

        renderWithProviders(<WorksheetExplorer />, {
          databases: [],
          editor: selectingTwo,
          openWorksheetId: 'ws-123',
          worksheets: threeWorksheets
        })

        fireEvent.contextMenu(screen.getByText('Second Worksheet'))

        await user.click(
          await screen.findByRole('menuitem', { name: 'Delete 2 worksheets' })
        )
        await user.click(screen.getByRole('button', { name: 'Delete' }))

        expect(
          await screen.findByText('Failed to delete 1 of 2 worksheets')
        ).toBeVisible()
        expect(await screen.findByText('Database is locked')).toBeVisible()
      })
    })
  })
})
