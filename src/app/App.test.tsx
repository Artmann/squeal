import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { App, useWorksheetSession } from './App'
import { useAppSelector } from './store'
import { selectActiveWorksheetId, tabsActions } from './store/tabs-slice'
import { renderWithProviders } from './test-utils'

vi.mock('./api-client', () => ({
  apiClient: {
    createQuery: vi.fn(),
    getDatabases: vi.fn(async () => []),
    getDatabaseSchema: vi.fn(async () => ({ tables: [] })),
    updateWorksheet: vi.fn()
  }
}))

import { apiClient } from './api-client'

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'pagila',
    host: 'localhost',
    port: 5432,
    username: 'postgres'
  },
  createdAt: 1,
  id: 'database-1',
  name: 'Pagila',
  sortOrder: null,
  type: 'postgres'
}

const testWorksheet: WorksheetDto = {
  content: 'SELECT 1;',
  createdAt: 1,
  databaseId: 'database-1',
  id: 'ws-1',
  lastOpenedAt: null,
  name: 'Analysis',
  sortOrder: 0
}

// Drives the session hook without CodeMirror: typing and running are separate
// events, exactly as they are in the app, so the render between them is the one
// the run has to see.
function RunProbe(): ReactElement {
  const { handleRunQuery, handleUpdateContent } = useWorksheetSession('ws-1')

  return (
    <>
      <button
        onClick={() => handleUpdateContent('SELECT 2;')}
        type="button"
      >
        type
      </button>

      <button
        onClick={handleRunQuery}
        type="button"
      >
        run
      </button>
    </>
  )
}

// Reads the open worksheet from the store exactly as App does, so switching
// worksheets in a test is the same dispatch the tab strip makes.
function ContentProbe(): ReactElement {
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const { content, handleUpdateContent } = useWorksheetSession(openWorksheetId)

  return (
    <>
      <button
        onClick={() => handleUpdateContent('EDITED')}
        type="button"
      >
        type
      </button>

      <output>{content}</output>
    </>
  )
}

describe('editor content', () => {
  const secondWorksheet: WorksheetDto = {
    ...testWorksheet,
    content: 'SELECT 9;',
    id: 'ws-2',
    name: 'Other'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(testWorksheet)
  })

  it('shows the saved content of the open worksheet', () => {
    renderWithProviders(<ContentProbe />, {
      databases: [testDatabase],
      openWorksheetId: 'ws-1',
      queries: [],
      worksheets: [testWorksheet, secondWorksheet]
    })

    expect(screen.getByRole('status')).toHaveTextContent('SELECT 1;')
  })

  // An unsaved edit belongs to the worksheet it was typed into; opening another
  // one must not carry it across.
  it('drops a pending edit when another worksheet is opened', () => {
    const { store } = renderWithProviders(<ContentProbe />, {
      databases: [testDatabase],
      queries: [],
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: [testWorksheet, secondWorksheet]
    })

    fireEvent.click(screen.getByRole('button', { name: 'type' }))

    expect(screen.getByRole('status')).toHaveTextContent('EDITED')

    act(() => {
      store.dispatch(tabsActions.tabActivated('ws-2'))
    })

    expect(screen.getByRole('status')).toHaveTextContent('SELECT 9;')
  })
})

describe('running a query', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(testWorksheet)
    vi.mocked(apiClient.createQuery).mockResolvedValue({
      query: {
        content: 'SELECT 2;',
        databaseId: 'database-1',
        error: null,
        finishedAt: null,
        id: 'q-1',
        queriedAt: 1,
        result: null,
        truncated: false,
        worksheetId: 'ws-1'
      }
    })
  })

  // The autosave debounce means the saved copy trails the editor by 300ms, so
  // running inside that window used to execute the previous text.
  it('runs the text in the editor rather than the last saved copy', async () => {
    renderWithProviders(<RunProbe />, {
      databases: [testDatabase],
      openWorksheetId: 'ws-1',
      queries: [],
      worksheets: [testWorksheet]
    })

    fireEvent.click(screen.getByRole('button', { name: 'type' }))
    fireEvent.click(screen.getByRole('button', { name: 'run' }))

    await waitFor(() => {
      expect(apiClient.createQuery).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'SELECT 2;' }),
        expect.anything()
      )
    })
  })

  it('saves the pending edit when a query runs', async () => {
    // Fake timers hold the autosave debounce open, so a save showing up here can
    // only have come from the run itself. `waitFor` would defeat that by
    // advancing timers until the debounce fired on its own.
    vi.useFakeTimers()

    try {
      renderWithProviders(<RunProbe />, {
        databases: [testDatabase],
        openWorksheetId: 'ws-1',
        queries: [],
        worksheets: [testWorksheet]
      })

      fireEvent.click(screen.getByRole('button', { name: 'type' }))
      fireEvent.click(screen.getByRole('button', { name: 'run' }))

      // Settles the collection's pending promises without moving the clock
      // anywhere near the 300ms debounce.
      await vi.advanceTimersByTimeAsync(0)

      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-1', {
        content: 'SELECT 2;'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App', () => {
  it('shows the getting started screen when there are no databases', () => {
    renderWithProviders(<App />, { databases: [], queries: [], worksheets: [] })

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
  })

  it('hides the getting started screen when a database exists', () => {
    renderWithProviders(<App />, {
      databases: [testDatabase],
      queries: [],
      worksheets: []
    })

    expect(screen.queryByText('Connect a database')).not.toBeInTheDocument()
  })

  it('keeps the getting started screen hidden once it is dismissed', () => {
    renderWithProviders(<App />, {
      databases: [],
      queries: [],
      ui: { gettingStartedDismissed: true },
      worksheets: []
    })

    expect(screen.queryByText('Connect a database')).not.toBeInTheDocument()
  })

  // The consent screen replaces App rather than overlaying it, so the two
  // first-run screens can never stack.
  it('shows only the getting started screen once the storage choice is made', () => {
    renderWithProviders(<App />, {
      databases: [],
      queries: [],
      secretStorageMode: 'plaintext',
      worksheets: []
    })

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
    expect(screen.queryByText('Welcome to Squeal')).not.toBeInTheDocument()
  })
})
