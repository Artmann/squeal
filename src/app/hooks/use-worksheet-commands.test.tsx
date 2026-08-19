import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { useWorksheets } from './queries'
import { useOpenWorksheet } from './use-worksheet-commands'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
    getDatabases: vi.fn(async () => []),
    getWorksheets: vi.fn(async () => []),
    updateWorksheet: vi.fn()
  }
}))

// Nothing here reads the worksheet list, so the collection is never subscribed
// and sits at `idle` holding nothing — which is what the guard is about. The
// real screens read it above their click handlers and so skip this state; a
// worksheet deleted in another window reaches the same missing key from
// `ready`, and that one has no such escape.
function OpenWorksheetProbe(): ReactElement {
  const openWorksheet = useOpenWorksheet()

  return (
    <button
      onClick={() => openWorksheet('ws-1')}
      type="button"
    >
      Open
    </button>
  )
}

// Reads the list, so the collection syncs and reaches `ready` — and still does
// not hold `ws-1`. That is where a worksheet deleted in another window between
// render and click leaves the handler, and no status can tell you about it.
function SubscribedOpenWorksheetProbe(): ReactElement {
  useWorksheets()

  return <OpenWorksheetProbe />
}

const otherWorksheet: WorksheetDto = {
  content: '',
  createdAt: 1704067200000,
  databaseId: null,
  id: 'ws-2',
  lastOpenedAt: null,
  name: 'Revenue',
  sortOrder: null
}

describe('useOpenWorksheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // `update` throws `CollectionOperationError` on a key the collection does not
  // hold, so an unguarded touch throws past the rest of the click handler. The
  // tab survives — it is dispatched first — but the rename that the create path
  // opens afterwards would not, and the error reaches the user as a
  // `renderer.error` trace. Only the timestamp is worth losing here.
  it('opens the tab without touching a worksheet the collection does not hold', async () => {
    const user = userEvent.setup()

    const { collections, store } = renderWithProviders(<OpenWorksheetProbe />)
    const update = vi.spyOn(collections.worksheets, 'update')

    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect({
      status: collections.worksheets.status,
      tabs: store.getState().tabs,
      updates: update.mock.calls
    }).toEqual({
      status: 'idle',
      tabs: {
        activeWorksheetId: 'ws-1',
        openWorksheetIds: ['ws-1'],
        status: 'reconciled'
      },
      updates: []
    })
  })

  it('opens the tab without touching a worksheet a ready collection has lost', async () => {
    const user = userEvent.setup()

    const { collections, store } = renderWithProviders(
      <SubscribedOpenWorksheetProbe />,
      { worksheets: [otherWorksheet] }
    )
    const update = vi.spyOn(collections.worksheets, 'update')

    await user.click(await screen.findByRole('button', { name: 'Open' }))

    expect({
      status: collections.worksheets.status,
      tabs: store.getState().tabs,
      updates: update.mock.calls
    }).toEqual({
      status: 'ready',
      tabs: {
        activeWorksheetId: 'ws-1',
        openWorksheetIds: ['ws-1'],
        status: 'reconciled'
      },
      updates: []
    })
  })
})
