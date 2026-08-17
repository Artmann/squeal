import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ReactElement } from 'react'
import invariant from 'tiny-invariant'
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

// `title-bar` is the class `index.css` hangs `-webkit-app-region: no-drag` off,
// so it is a contract rather than a styling detail.
function getTitleBar(): HTMLElement {
  const titleBar = document.querySelector<HTMLElement>('.title-bar')

  invariant(titleBar, 'The title bar is not in the document.')

  return titleBar
}

// The single slot every screen shares, found by where it sits rather than by
// what it is called: the element directly after the title bar.
function getScreenSlot(): HTMLElement {
  const slot = getTitleBar().nextElementSibling

  invariant(
    slot instanceof HTMLElement,
    'Nothing follows the title bar, so there is no screen slot.'
  )

  return slot
}

/**
 * What issue #60 is actually about: the title bar is painted above `element`
 * and cannot be covered by it. Two separate things make that true, and both are
 * asserted because either can be deleted without the other noticing.
 *
 * - `element` lives in the slot that follows the title bar, so it cannot reach
 *   the title bar through the flow. A `fixed inset-0` screen — what #60 was —
 *   fails this.
 * - That slot is a positioned containing block, so an `absolute inset-0` child
 *   of it cannot reach the title bar around the flow either. This is a class
 *   check only because jsdom loads no CSS, which leaves `position` unobservable
 *   any other way; without it, dropping `relative` from the slot silently
 *   reopens #60 for the editor screen.
 */
function expectTitleBarAbove(element: HTMLElement): void {
  const slot = getScreenSlot()

  expect(getTitleBar().contains(element)).toEqual(false)
  expect(slot.contains(element)).toEqual(true)
  expect(slot).toHaveClass('relative')
}

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

  // The window is frameless, so the title bar is the only minimize, maximize,
  // close and drag region Windows and Linux have. A first-run screen that
  // covers it leaves the window unmovable and unclosable.
  it('leaves the window controls uncovered while the getting started screen shows', () => {
    renderWithProviders(<App />, { databases: [], queries: [], worksheets: [] })

    // Scoped to the title bar because the getting started screen has an X of
    // its own with the same accessible name.
    const windowControls = within(getTitleBar())

    expect(
      windowControls.getByRole('button', { name: 'Close' })
    ).toBeInTheDocument()
    expect(
      windowControls.getByRole('button', { name: 'Maximize' })
    ).toBeInTheDocument()
    expect(
      windowControls.getByRole('button', { name: 'Minimize' })
    ).toBeInTheDocument()

    expectTitleBarAbove(screen.getByText('Connect a database'))
  })

  // The editor screen's scrim is translucent, so it left the title bar visible
  // but unclickable and its drag region dead — the same defect, harder to see.
  it('leaves the window controls uncovered while the editor screen shows', () => {
    renderWithProviders(<App />, {
      databases: [testDatabase],
      queries: [],
      ui: { editorScreen: { databaseId: 'database-1', type: 'edit-database' } },
      worksheets: []
    })

    expect(
      within(getTitleBar()).getByRole('button', { name: 'Close' })
    ).toBeInTheDocument()

    expectTitleBarAbove(screen.getByText('Edit database'))
  })

  // Every workspace hook and poller used to run behind an opaque first-run
  // screen, keyboard-reachable with nothing trapping focus.
  it('does not mount the workspace behind the getting started screen', () => {
    renderWithProviders(<App />, { databases: [], queries: [], worksheets: [] })

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
    expect(screen.queryByLabelText('Resize sidebar')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open traces')).not.toBeInTheDocument()
  })

  // A stored editor screen and a first run were both representable at once,
  // which stacked two panels with two live connection forms in them.
  it('shows a single add-database form when the editor screen is open on first run', () => {
    renderWithProviders(<App />, {
      databases: [],
      queries: [],
      ui: { editorScreen: { type: 'create-database' } },
      worksheets: []
    })

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
    expect(screen.queryByText('Add database')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
  })

  // Reachable: delete the last connection while its "Add database" modal is
  // open, and the first-run screen takes the slot with the modal still stored.
  // Leaving the screen then popped a modal nobody asked for.
  it('drops a stale editor screen while the getting started screen shows', () => {
    const { store } = renderWithProviders(<App />, {
      databases: [],
      queries: [],
      ui: { editorScreen: { type: 'create-database' } },
      worksheets: []
    })

    expect(store.getState().ui.editorScreen).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))

    expect(screen.queryByText('Add database')).not.toBeInTheDocument()
  })
})
