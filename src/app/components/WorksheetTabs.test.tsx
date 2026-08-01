import { screen } from '@testing-library/react'
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
      openWorksheetIds: ['ws-1', 'ws-2']
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
      openWorksheetIds: ['ws-2']
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
      openWorksheetIds: ['ws-1', 'ws-3']
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
      openWorksheetIds: ['ws-1']
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
      openWorksheetIds: ['ws-2']
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
      openWorksheetIds: ['ws-1', 'ws-new']
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
})
