import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { DatabaseSelector } from './DatabaseSelector'

vi.mock('../api-client', () => ({
  apiClient: {
    updateWorksheet: vi.fn()
  }
}))

// Radix UI Select uses DOM APIs not available in jsdom.
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

import { apiClient } from '../api-client'

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'testdb',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  id: 'db-1',
  name: 'Production DB',
  type: 'postgres'
}

const testDatabase2: DatabaseDto = {
  ...testDatabase,
  id: 'db-2',
  name: 'Staging DB'
}

const testWorksheet: WorksheetDto = {
  content: 'SELECT * FROM users',
  createdAt: 1704067200000,
  databaseId: 'db-1',
  id: 'ws-123',
  lastOpenedAt: null,
  name: 'Test Worksheet'
}

describe('DatabaseSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('displays the database selected for the open worksheet', () => {
    renderWithProviders(<DatabaseSelector />, {
      databases: [testDatabase, testDatabase2],
      editor: { openWorksheetId: 'ws-123' },
      worksheets: [testWorksheet]
    })

    expect(screen.getByText('Production DB')).toBeInTheDocument()
  })

  it('shows "No databases configured" when there are no databases', () => {
    renderWithProviders(<DatabaseSelector />, {
      databases: [],
      editor: { openWorksheetId: 'ws-123' },
      worksheets: [testWorksheet]
    })

    expect(screen.getByText('No databases configured')).toBeInTheDocument()
  })

  it('updates the worksheet with the chosen database id', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateWorksheet).mockResolvedValue({
      ...testWorksheet,
      databaseId: 'db-2'
    })

    renderWithProviders(<DatabaseSelector />, {
      databases: [testDatabase, testDatabase2],
      editor: { openWorksheetId: 'ws-123' },
      worksheets: [testWorksheet]
    })

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Staging DB'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
        databaseId: 'db-2'
      })
    })
  })

  it('optimistically updates the database while preserving other fields', async () => {
    const user = userEvent.setup()

    // Never resolves so we can inspect the optimistic cache state.
    vi.mocked(apiClient.updateWorksheet).mockImplementation(
      () =>
        new Promise<WorksheetDto>(() => {
          // Never resolves so the optimistic state can be inspected.
        })
    )

    const { collections } = renderWithProviders(<DatabaseSelector />, {
      databases: [testDatabase, testDatabase2],
      editor: { openWorksheetId: 'ws-123' },
      worksheets: [testWorksheet]
    })

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Staging DB'))

    await waitFor(() => {
      expect(collections.worksheets.get('ws-123')).toEqual({
        ...testWorksheet,
        $collectionId: expect.any(String),
        $key: 'ws-123',
        $origin: 'local',
        $synced: false,
        databaseId: 'db-2'
      })
    })
  })
})
