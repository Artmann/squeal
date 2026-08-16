import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { WorksheetTabs } from './WorksheetTabs'

vi.mock('../api-client', () => ({
  apiClient: {
    createWorksheet: vi.fn(),
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
const churn = worksheet('ws-3', 'Churn')

const allWorksheets = [revenue, signups, churn]

describe('WorksheetTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.updateWorksheet).mockResolvedValue(revenue)
  })

  it('renders a tab per open worksheet and nothing for closed ones', () => {
    renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    expect(screen.getByRole('tab', { name: 'Revenue' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Signups' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Churn' })).not.toBeInTheDocument()
  })

  it('marks the active tab as selected', () => {
    renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-2', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    expect(screen.getByRole('tab', { name: 'Signups' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tab', { name: 'Revenue' })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('activates a worksheet when its tab is clicked', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    await user.click(screen.getByRole('tab', { name: 'Signups' }))

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-2',
      openWorksheetIds: ['ws-1', 'ws-2'],
      status: 'reconciled'
    })
  })

  it('closes a tab without activating it', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-2', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    await user.click(screen.getByRole('button', { name: 'Close Revenue' }))

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-2',
      openWorksheetIds: ['ws-2'],
      status: 'reconciled'
    })
  })

  it('activates the last remaining tab when the active one is closed', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: {
        activeWorksheetId: 'ws-2',
        openWorksheetIds: ['ws-1', 'ws-2', 'ws-3']
      },
      worksheets: allWorksheets
    })

    await user.click(screen.getByRole('button', { name: 'Close Signups' }))

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-3',
      openWorksheetIds: ['ws-1', 'ws-3'],
      status: 'reconciled'
    })
  })

  it('closes a tab on middle click', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    await user.pointer({
      keys: '[MouseMiddle]',
      target: screen.getByRole('tab', { name: 'Signups' })
    })

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-1',
      openWorksheetIds: ['ws-1'],
      status: 'reconciled'
    })
  })

  it('closes the active tab with the keyboard shortcut', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
      worksheets: allWorksheets
    })

    await user.keyboard('{Meta>}w{/Meta}')

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-2',
      openWorksheetIds: ['ws-2'],
      status: 'reconciled'
    })
  })

  it('opens a newly created worksheet in a tab', async () => {
    const user = userEvent.setup()
    const created = worksheet('ws-new', 'Untitled')

    vi.mocked(apiClient.createWorksheet).mockResolvedValue(created)

    const { store } = renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1'] },
      worksheets: [revenue]
    })

    await user.click(screen.getByRole('button', { name: 'New worksheet' }))

    await screen.findByRole('tab', { name: 'Untitled' })

    expect(store.getState().tabs).toEqual({
      activeWorksheetId: 'ws-new',
      openWorksheetIds: ['ws-1', 'ws-new'],
      status: 'reconciled'
    })
  })

  it('renders only the new-tab button when nothing is open', () => {
    renderWithProviders(<WorksheetTabs />, {
      tabs: { openWorksheetIds: [] },
      worksheets: allWorksheets
    })

    expect(screen.queryAllByRole('tab')).toEqual([])
    expect(
      screen.getByRole('button', { name: 'New worksheet' })
    ).toBeInTheDocument()
  })

  it('gives a new worksheet the active tab’s database', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.createWorksheet).mockResolvedValue(
      worksheet('ws-new', 'Untitled')
    )

    renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1'] },
      worksheets: [{ ...revenue, databaseId: 'db-123' }]
    })

    await user.click(screen.getByRole('button', { name: 'New worksheet' }))

    await waitFor(() => {
      expect(apiClient.createWorksheet).toHaveBeenCalledWith({
        databaseId: 'db-123',
        name: 'Untitled'
      })
    })
  })

  it('leaves the database out when no tab has one', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.createWorksheet).mockResolvedValue(
      worksheet('ws-new', 'Untitled')
    )

    renderWithProviders(<WorksheetTabs />, {
      tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1'] },
      worksheets: [revenue]
    })

    await user.click(screen.getByRole('button', { name: 'New worksheet' }))

    await waitFor(() => {
      expect(apiClient.createWorksheet).toHaveBeenCalledWith({
        name: 'Untitled'
      })
    })
  })

  describe('rename', () => {
    it('opens the name for editing on double click', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

      expect(screen.getByRole('textbox', { name: 'Rename Revenue' })).toEqual(
        screen.getByDisplayValue('Revenue')
      )
    })

    it('saves the new name on Enter', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

      const input = screen.getByDisplayValue('Revenue')

      await user.clear(input)
      await user.type(input, 'Monthly Revenue{Enter}')

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-1', {
          name: 'Monthly Revenue'
        })
      })
    })

    it('saves the new name on blur', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

      const input = screen.getByDisplayValue('Revenue')

      await user.clear(input)
      await user.type(input, 'Blurred Name')
      await user.tab()

      await waitFor(() => {
        expect(apiClient.updateWorksheet).toHaveBeenCalledWith('ws-1', {
          name: 'Blurred Name'
        })
      })
    })

    it('cancels editing on Escape', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

      const input = screen.getByDisplayValue('Revenue')

      await user.clear(input)
      await user.type(input, 'Discarded{Escape}')

      expect(screen.getByRole('tab', { name: 'Revenue' })).toBeInTheDocument()
      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
    })

    it('does not save an empty name', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))

      const input = screen.getByDisplayValue('Revenue')

      await user.clear(input)
      await user.type(input, '{Enter}')

      expect(screen.getByRole('tab', { name: 'Revenue' })).toBeInTheDocument()
      expect(apiClient.updateWorksheet).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.any(String) })
      )
    })

    it('starts a rename from the context menu', async () => {
      const user = userEvent.setup()

      renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      fireEvent.contextMenu(screen.getByRole('tab', { name: 'Signups' }))

      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

      expect(await screen.findByDisplayValue('Signups')).toBeVisible()
    })

    it('closes a tab from the context menu', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      fireEvent.contextMenu(screen.getByRole('tab', { name: 'Signups' }))

      await user.click(await screen.findByRole('menuitem', { name: 'Close' }))

      expect(store.getState().tabs).toEqual({
        activeWorksheetId: 'ws-1',
        openWorksheetIds: ['ws-1'],
        status: 'reconciled'
      })
    })

    // The close shortcut runs on form tags, so without a guard it would take
    // the tab away while its name is still being typed.
    it('does not close the tab while its name is being edited', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.dblClick(screen.getByRole('tab', { name: 'Revenue' }))
      await user.keyboard('{Meta>}w{/Meta}')

      expect(store.getState().tabs).toEqual({
        activeWorksheetId: 'ws-1',
        openWorksheetIds: ['ws-1', 'ws-2'],
        status: 'reconciled'
      })
    })
  })

  describe('keyboard tab switching', () => {
    it('activates the tab at the pressed position', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<WorksheetTabs />, {
        tabs: {
          activeWorksheetId: 'ws-1',
          openWorksheetIds: ['ws-1', 'ws-2', 'ws-3']
        },
        worksheets: allWorksheets
      })

      await user.keyboard('{Meta>}2{/Meta}')

      expect(store.getState().tabs).toEqual({
        activeWorksheetId: 'ws-2',
        openWorksheetIds: ['ws-1', 'ws-2', 'ws-3'],
        status: 'reconciled'
      })
    })

    // Browser convention: the ninth slot is the last tab, however many are open.
    it('jumps to the last tab on the ninth position', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<WorksheetTabs />, {
        tabs: {
          activeWorksheetId: 'ws-1',
          openWorksheetIds: ['ws-1', 'ws-2', 'ws-3']
        },
        worksheets: allWorksheets
      })

      await user.keyboard('{Meta>}9{/Meta}')

      expect(store.getState().tabs).toEqual({
        activeWorksheetId: 'ws-3',
        openWorksheetIds: ['ws-1', 'ws-2', 'ws-3'],
        status: 'reconciled'
      })
    })

    it('ignores a position past the last tab', async () => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<WorksheetTabs />, {
        tabs: { activeWorksheetId: 'ws-1', openWorksheetIds: ['ws-1', 'ws-2'] },
        worksheets: allWorksheets
      })

      await user.keyboard('{Meta>}5{/Meta}')

      expect(store.getState().tabs).toEqual({
        activeWorksheetId: 'ws-1',
        openWorksheetIds: ['ws-1', 'ws-2'],
        status: 'reconciled'
      })
    })
  })
})
