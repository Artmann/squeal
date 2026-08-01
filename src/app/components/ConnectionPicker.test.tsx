import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { ConnectionPicker } from './ConnectionPicker'

vi.mock('../api-client', () => ({
  apiClient: {
    updateWorksheet: vi.fn()
  }
}))

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
  sortOrder: null,
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
  name: 'Test Worksheet',
  sortOrder: null
}

const bothDatabases = {
  databases: [testDatabase, testDatabase2],
  openWorksheetId: 'ws-123',
  worksheets: [testWorksheet]
}

describe('ConnectionPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the database selected for the open worksheet', () => {
    renderWithProviders(<ConnectionPicker />, bothDatabases)

    const trigger = screen.getByRole('button')

    expect(trigger).toHaveTextContent('Production DB')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens a listbox with an autofocused search field', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ConnectionPicker />, bothDatabases)

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByPlaceholderText('Search databases')).toHaveFocus()
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['Production DB', 'Staging DB'])
  })

  it('filters the options and shows the empty state when nothing matches', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ConnectionPicker />, bothDatabases)

    await user.click(screen.getByRole('button'))
    await user.type(screen.getByPlaceholderText('Search databases'), 'stag')

    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['Staging DB'])

    await user.clear(screen.getByPlaceholderText('Search databases'))
    await user.type(screen.getByPlaceholderText('Search databases'), 'nope')

    expect(screen.queryAllByRole('option')).toEqual([])
    expect(
      screen.getByText('No databases match that search.')
    ).toBeInTheDocument()
  })

  it('selects the highlighted database with the arrow keys and Enter', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateWorksheet).mockResolvedValue({
      ...testWorksheet,
      databaseId: 'db-2'
    })

    renderWithProviders(<ConnectionPicker />, bothDatabases)

    await user.click(screen.getByRole('button'))

    const search = screen.getByPlaceholderText('Search databases')

    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[0].id
    )

    await user.keyboard('{ArrowDown}')

    expect(search).toHaveAttribute(
      'aria-activedescendant',
      screen.getAllByRole('option')[1].id
    )

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
        databaseId: 'db-2'
      })
    })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveFocus()
  })

  it('optimistically updates the worksheet while the save is in flight', async () => {
    const user = userEvent.setup()

    // Never resolves so the optimistic cache state can be inspected.
    vi.mocked(apiClient.updateWorksheet).mockImplementation(
      () =>
        new Promise<WorksheetDto>(() => {
          // Never resolves so the optimistic state can be inspected.
        })
    )

    const { collections } = renderWithProviders(
      <ConnectionPicker />,
      bothDatabases
    )

    await user.click(screen.getByRole('button'))
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

  it('selects a database when its option is clicked', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateWorksheet).mockResolvedValue({
      ...testWorksheet,
      databaseId: 'db-2'
    })

    renderWithProviders(<ConnectionPicker />, bothDatabases)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Staging DB'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-123', {
        databaseId: 'db-2'
      })
    })
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ConnectionPicker />, bothDatabases)

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveFocus()
  })

  it('closes when clicking outside of the picker', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <div>
        <ConnectionPicker />

        <button type="button">Somewhere else</button>
      </div>,
      bothDatabases
    )

    await user.click(screen.getByRole('button', { name: /Production DB/ }))

    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Somewhere else' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('offers to add a database when none are configured', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<ConnectionPicker />, {
      databases: [],
      openWorksheetId: 'ws-123',
      worksheets: [testWorksheet]
    })

    expect(screen.getByRole('button')).toHaveTextContent('No database')

    await user.click(screen.getByRole('button'))

    expect(store.getState().ui.editorScreen).toEqual({
      type: 'create-database'
    })
  })
})
