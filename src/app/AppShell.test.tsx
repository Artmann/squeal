import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './AppShell'
import { apiClient } from './api-client'
import { renderWithProviders } from './test-utils'
import type { DatabaseDto } from '@/glue/databases'
import type { WorksheetDto } from '@/glue/worksheets'

vi.mock('./api-client', () => ({
  apiClient: {
    getDatabases: vi.fn(),
    getQueries: vi.fn(),
    getWorksheets: vi.fn()
  }
}))

const worksheet: WorksheetDto = {
  content: 'select 1',
  createdAt: 1,
  databaseId: null,
  id: 'worksheet-1',
  lastOpenedAt: null,
  name: 'My First Worksheet',
  sortOrder: null
}

const database: DatabaseDto = {
  connectionInfo: {
    database: 'pagila',
    host: 'localhost',
    port: 5432,
    username: 'postgres'
  },
  createdAt: 1,
  id: 'database-1',
  name: 'Local',
  sortOrder: null,
  type: 'postgres'
}

// Nothing is seeded into the query cache on purpose: the collections have to
// actually fetch, so the test exercises the real load and error paths.
function resolveAll(): void {
  vi.mocked(apiClient.getDatabases).mockResolvedValue([database])
  vi.mocked(apiClient.getQueries).mockResolvedValue([])
  vi.mocked(apiClient.getWorksheets).mockResolvedValue([worksheet])
}

describe('AppShell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders its children once every collection has loaded', async () => {
    resolveAll()

    renderWithProviders(<AppShell>data loaded</AppShell>)

    expect(await screen.findByText('data loaded')).toBeInTheDocument()
  })

  it('starts every collection loading at once instead of one after another', async () => {
    let releaseWorksheets: ((worksheets: WorksheetDto[]) => void) | undefined

    resolveAll()
    vi.mocked(apiClient.getWorksheets).mockReturnValue(
      new Promise((resolve) => {
        releaseWorksheets = resolve
      })
    )

    renderWithProviders(<AppShell>data loaded</AppShell>)

    // While worksheets is still in flight the other two have already been
    // requested. Reading the collections one after another meant the first
    // suspending read stopped the others from mounting until it settled.
    await waitFor(() => {
      expect(apiClient.getDatabases).toHaveBeenCalled()
      expect(apiClient.getQueries).toHaveBeenCalled()
    })

    expect(screen.queryByText('data loaded')).not.toBeInTheDocument()

    releaseWorksheets?.([worksheet])

    expect(await screen.findByText('data loaded')).toBeInTheDocument()
  })

  it('shows the error screen rather than an empty app when a load fails', async () => {
    resolveAll()
    vi.mocked(apiClient.getWorksheets).mockRejectedValue(
      new Error('backend is down')
    )

    renderWithProviders(<AppShell>data loaded</AppShell>)

    expect(
      await screen.findByText('Could not load your data')
    ).toBeInTheDocument()
    expect(screen.queryByText('data loaded')).not.toBeInTheDocument()
  })

  it('recovers when the retry succeeds', async () => {
    resolveAll()
    vi.mocked(apiClient.getWorksheets)
      .mockRejectedValueOnce(new Error('backend is down'))
      .mockResolvedValue([worksheet])

    renderWithProviders(<AppShell>data loaded</AppShell>)

    await screen.findByText('Could not load your data')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('data loaded')).toBeInTheDocument()
  })

  it('stays on the error screen when the retry fails again', async () => {
    resolveAll()
    vi.mocked(apiClient.getWorksheets).mockRejectedValue(
      new Error('backend is down')
    )

    renderWithProviders(<AppShell>data loaded</AppShell>)

    await screen.findByText('Could not load your data')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.getByText('Could not load your data')).toBeInTheDocument()
    })

    expect(screen.queryByText('data loaded')).not.toBeInTheDocument()
  })

  it('does not retry the collections that loaded fine', async () => {
    resolveAll()
    vi.mocked(apiClient.getWorksheets)
      .mockRejectedValueOnce(new Error('backend is down'))
      .mockResolvedValue([worksheet])

    renderWithProviders(<AppShell>data loaded</AppShell>)

    await screen.findByText('Could not load your data')

    const databaseCallsBeforeRetry = vi.mocked(apiClient.getDatabases).mock
      .calls.length

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('data loaded')

    expect(vi.mocked(apiClient.getDatabases).mock.calls.length).toEqual(
      databaseCallsBeforeRetry
    )
  })
})
