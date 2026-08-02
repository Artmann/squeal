import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'pagila',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
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

  it('renders worksheet names', () => {
    renderWithProviders(<WorksheetExplorer />, {
      databases: [],
      worksheets: [testWorksheet]
    })

    expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
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
    const secondWorksheet: WorksheetDto = {
      content: '',
      createdAt: 1704067300000,
      databaseId: null,
      id: 'ws-456',
      lastOpenedAt: null,
      name: 'Second Worksheet',
      sortOrder: null
    }

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

    it('deletes a worksheet after confirming via the action toast', async () => {
      const user = userEvent.setup()

      vi.mocked(apiClient.deleteWorksheet).mockResolvedValue(undefined)

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Second Worksheet'))

      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

      // The toast asks first; nothing is deleted until it is confirmed.
      expect(apiClient.deleteWorksheet).not.toHaveBeenCalled()
      expect(
        await screen.findByText('Delete "Second Worksheet"?')
      ).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(apiClient.deleteWorksheet).toHaveBeenCalledWith('ws-456')
      })
    })

    it('does not delete when the confirmation is ignored', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetExplorer />, {
        databases: [],
        worksheets: [testWorksheet, secondWorksheet]
      })

      fireEvent.contextMenu(screen.getByText('Second Worksheet'))

      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))

      expect(
        await screen.findByText('Delete "Second Worksheet"?')
      ).toBeVisible()
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
})
