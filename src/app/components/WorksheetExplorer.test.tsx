import { configureStore } from '@reduxjs/toolkit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorksheetDto } from '@/glue/worksheets'

import editorReducer from '../store/editor-slice'
import { WorksheetExplorer } from './WorksheetExplorer'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
    updateWorksheet: vi.fn().mockResolvedValue({})
  }
}))

import { apiClient } from '../api-client'

const testWorksheet: WorksheetDto = {
  content: 'SELECT * FROM users',
  createdAt: 1704067200000,
  databaseId: null,
  id: 'ws-123',
  lastOpenedAt: null,
  name: 'Test Worksheet'
}

function createTestStore(options?: {
  openWorksheetId?: string
  worksheets?: WorksheetDto[]
}) {
  return configureStore({
    preloadedState: {
      editor: {
        databases: [],
        databaseSearchQuery: '',
        openWorksheetId: options?.openWorksheetId,
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

describe('WorksheetExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the header', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <WorksheetExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Worksheets')).toBeInTheDocument()
  })

  it('renders worksheet names', () => {
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <WorksheetExplorer />
      </TestEnvironment>
    )

    expect(screen.getByText('Test Worksheet')).toBeInTheDocument()
  })

  it('selects worksheet on single click', async () => {
    const user = userEvent.setup()
    const store = createTestStore()

    render(
      <TestEnvironment store={store}>
        <WorksheetExplorer />
      </TestEnvironment>
    )

    await user.click(screen.getByText('Test Worksheet'))

    expect(store.getState().editor.openWorksheetId).toEqual('ws-123')
  })

  it('selecting a worksheet should call updateWorksheet with lastOpenedAt', async () => {
    const user = userEvent.setup()
    const secondWorksheet: WorksheetDto = {
      content: '',
      createdAt: 1704067300000,
      databaseId: null,
      id: 'ws-456',
      lastOpenedAt: null,
      name: 'Second Worksheet'
    }

    const store = createTestStore({
      worksheets: [testWorksheet, secondWorksheet],
      openWorksheetId: 'ws-123'
    })

    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(secondWorksheet)

    render(
      <TestEnvironment store={store}>
        <WorksheetExplorer />
      </TestEnvironment>
    )

    await user.click(screen.getByText('Second Worksheet'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-456', {
        lastOpenedAt: expect.any(Number)
      })
    })
  })

  describe('rename functionality', () => {
    it('enters edit mode on double click', async () => {
      const user = userEvent.setup()
      const store = createTestStore()

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      expect(input).toBeInTheDocument()
      expect(input.tagName).toEqual('INPUT')
    })

    it('saves new name on Enter key', async () => {
      const user = userEvent.setup()
      const store = createTestStore()
      const updatedWorksheet = { ...testWorksheet, name: 'Renamed Worksheet' }

      vi.mocked(apiClient.updateWorksheet).mockResolvedValue(updatedWorksheet)

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.clear(input)
      await user.type(input, 'Renamed Worksheet{Enter}')

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
          name: 'Renamed Worksheet'
        })
      })

      await waitFor(() => {
        expect(store.getState().editor.worksheets[0].name).toEqual(
          'Renamed Worksheet'
        )
      })
    })

    it('cancels editing on Escape key', async () => {
      const user = userEvent.setup()
      const store = createTestStore()

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

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

    it('saves new name on blur', async () => {
      const user = userEvent.setup()
      const store = createTestStore()
      const updatedWorksheet = { ...testWorksheet, name: 'Blurred Name' }

      vi.mocked(apiClient.updateWorksheet).mockResolvedValue(updatedWorksheet)

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

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

    it('does not save empty name', async () => {
      const user = userEvent.setup()
      const store = createTestStore()

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

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

    it('does not save if name is unchanged', async () => {
      const user = userEvent.setup()
      const store = createTestStore()

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

      await user.dblClick(screen.getByText('Test Worksheet'))

      const input = screen.getByDisplayValue('Test Worksheet')

      await user.type(input, '{Enter}')

      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
    })

    it('can rename a newly created worksheet', async () => {
      const user = userEvent.setup()
      const store = createTestStore({ worksheets: [] })

      const createdWorksheet: WorksheetDto = {
        content: '',
        createdAt: Date.now(),
        databaseId: null,
        id: 'real-db-id',
        lastOpenedAt: null,
        name: 'Worksheet 01/05/2026 12:00:00'
      }

      vi.mocked(apiClient.createWorksheet).mockResolvedValue(createdWorksheet)

      const renamedWorksheet = { ...createdWorksheet, name: 'My New Worksheet' }

      vi.mocked(apiClient.updateWorksheet).mockResolvedValue(renamedWorksheet)

      render(
        <TestEnvironment store={store}>
          <WorksheetExplorer />
        </TestEnvironment>
      )

      // Click the add button to create a new worksheet
      const buttons = screen.getAllByRole('button')
      const addButton = buttons.find((button) =>
        button.querySelector('svg.lucide-plus')
      )

      await user.click(addButton as HTMLElement)

      // Wait for the API call to complete
      await waitFor(() => {
        expect(apiClient.createWorksheet).toHaveBeenCalled()
      })

      // Find and double-click the worksheet to rename it
      const worksheetButton = await screen.findByRole('button', {
        name: /Worksheet/
      })

      await user.dblClick(worksheetButton)

      // Type new name and save
      const input = screen.getByDisplayValue(/Worksheet/)

      await user.clear(input)
      await user.type(input, 'My New Worksheet{Enter}')

      // Should call updateWorksheet with the REAL database ID, not the optimistic ID
      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('real-db-id', {
          name: 'My New Worksheet'
        })
      })
    })
  })
})
