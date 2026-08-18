import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { WorksheetExplorer } from './WorksheetExplorer'
import { WorksheetTabs } from './WorksheetTabs'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
    deleteWorksheet: vi.fn(),
    getDatabases: vi.fn(async () => []),
    updateWorksheet: vi.fn()
  }
}))

import { apiClient } from '../api-client'

function worksheet(id: string, name: string): WorksheetDto {
  return {
    content: '',
    createdAt: 1704067200000,
    databaseId: null,
    id,
    lastOpenedAt: null,
    name,
    sortOrder: null
  }
}

const revenue = worksheet('ws-1', 'Revenue')
const signups = worksheet('ws-2', 'Signups')

const allWorksheets = [revenue, signups]

const openTabs = {
  activeWorksheetId: 'ws-1',
  openWorksheetIds: ['ws-1', 'ws-2']
}

function renderBothSurfaces() {
  return renderWithProviders(
    <>
      <WorksheetExplorer />
      <WorksheetTabs />
    </>,
    { databases: [], tabs: openTabs, worksheets: allWorksheets }
  )
}

// The sidebar list and the tab strip are mounted at the same time, and the tab
// hotkeys are registered with enableOnFormTags, so they fire while a rename
// input has the keyboard. The tab strip knew only about renames it had started
// itself, which left every hotkey live during a sidebar rename.
describe('renaming a worksheet from the sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(revenue)
  })

  it('opens only one input, whichever surface asked last', async () => {
    const user = userEvent.setup()

    renderBothSurfaces()

    await user.dblClick(screen.getByRole('button', { name: 'Revenue' }))
    await user.dblClick(screen.getByRole('tab', { name: 'Signups' }))

    expect(screen.getAllByRole('textbox', { name: /^Rename/ })).toHaveLength(1)
  })

  it('swallows the close shortcut instead of leaving it to the window', async () => {
    const user = userEvent.setup()

    renderBothSurfaces()

    await user.dblClick(screen.getByRole('button', { name: 'Revenue' }))

    // fireEvent answers false when the handler called preventDefault. Letting
    // the event through is not inert: mod+w is Electron's own `close`
    // accelerator, so the whole window would go.
    const wasNotPrevented = fireEvent.keyDown(document, {
      code: 'KeyW',
      key: 'w',
      metaKey: true
    })

    expect(wasNotPrevented).toEqual(false)
  })

  it('keeps a name typed in the other surface when a new worksheet takes the session', async () => {
    const user = userEvent.setup()

    let publishWorksheet: ((worksheet: WorksheetDto) => void) | undefined

    vi.mocked(apiClient.createWorksheet).mockReturnValue(
      new Promise<WorksheetDto>((resolve) => {
        publishWorksheet = resolve
      })
    )

    renderBothSurfaces()

    // The tab strip has a New worksheet button of its own, but only the
    // sidebar's opens the new name for editing.
    const explorerHeader = screen.getByRole('heading', {
      name: 'Worksheets'
    }).parentElement

    invariant(
      explorerHeader,
      'The Worksheets heading sits in the explorer header.'
    )

    // The create is in flight, so its rename starts with no click and no focus
    // change — nothing blurs the input the user is typing in.
    await user.click(
      within(explorerHeader).getByRole('button', { name: 'New worksheet' })
    )

    await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

    const input = screen.getByDisplayValue('Revenue')

    await user.clear(input)
    await user.type(input, 'Q3 Revenue')

    invariant(publishWorksheet, 'The create should have been started.')

    publishWorksheet(worksheet('ws-3', 'Untitled Worksheet'))

    await waitFor(() => {
      expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-1', {
        name: 'Q3 Revenue'
      })
    })
  })

  it('leaves the close shortcut inert while the name is being edited', async () => {
    const user = userEvent.setup()

    const { store } = renderBothSurfaces()

    await user.dblClick(screen.getByRole('button', { name: 'Revenue' }))

    expect(
      screen.getByRole('textbox', { name: 'Rename Revenue' })
    ).toBeInTheDocument()

    await user.keyboard('{Meta>}w{/Meta}')

    expect(store.getState().tabs).toEqual({
      ...openTabs,
      status: 'reconciled'
    })
  })

  it('leaves the tab position shortcuts inert while the name is being edited', async () => {
    const user = userEvent.setup()

    const { store } = renderBothSurfaces()

    await user.dblClick(screen.getByRole('button', { name: 'Revenue' }))

    expect(
      screen.getByRole('textbox', { name: 'Rename Revenue' })
    ).toBeInTheDocument()

    await user.keyboard('{Meta>}2{/Meta}')

    expect(store.getState().tabs).toEqual({
      ...openTabs,
      status: 'reconciled'
    })
  })

  it('releases the hotkeys when the renamed worksheet is gone', async () => {
    const user = userEvent.setup()

    // Deleting a worksheet mid-rename unmounts its input without ending the
    // session, and nothing else ever will — there is no input left to blur or
    // press Escape in. Held on to, it dead-keys mod+w and mod+1…9 for the rest
    // of the session.
    const { store } = renderWithProviders(<WorksheetTabs />, {
      editor: {
        worksheetRename: {
          draftName: 'Deleted',
          scope: 'explorer',
          worksheetId: 'ws-gone'
        }
      },
      tabs: openTabs,
      worksheets: allWorksheets
    })

    await user.keyboard('{Meta>}2{/Meta}')

    expect(store.getState().tabs).toEqual({
      ...openTabs,
      activeWorksheetId: 'ws-2',
      status: 'reconciled'
    })
  })
})
