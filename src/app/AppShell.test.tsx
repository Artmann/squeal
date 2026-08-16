import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { AppShell } from './AppShell'
import { apiClient } from './api-client'
import { renderWithProviders } from './test-utils'
import type { DatabaseDto } from '@/glue/databases'
import type { WorksheetDto } from '@/glue/worksheets'

vi.mock('./api-client', () => ({
  apiClient: {
    getDatabases: vi.fn(),
    getQueries: vi.fn(),
    getSecretStorage: vi.fn(),
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

  describe('the secret storage gate', () => {
    it('asks about the keychain before showing the app', async () => {
      resolveAll()

      renderWithProviders(<AppShell>data loaded</AppShell>, {
        secretStorageMode: 'undecided'
      })

      expect(await screen.findByText('Welcome to Squeal')).toBeInTheDocument()
      expect(screen.queryByText('data loaded')).not.toBeInTheDocument()
    })

    it.each(['keychain' as const, 'plaintext' as const])(
      'shows the app once the choice is %s',
      async (secretStorageMode) => {
        resolveAll()

        renderWithProviders(<AppShell>data loaded</AppShell>, {
          secretStorageMode
        })

        expect(await screen.findByText('data loaded')).toBeInTheDocument()
        expect(screen.queryByText('Welcome to Squeal')).not.toBeInTheDocument()
      }
    )

    // The read suspends rather than defaulting, so a returning user never sees
    // the consent screen flash before their app.
    it('shows the spinner rather than the consent screen while the mode loads', async () => {
      let releaseMode:
        | ((response: {
            message: null
            mode: 'keychain'
            storageName: string
          }) => void)
        | undefined

      resolveAll()
      vi.mocked(apiClient.getSecretStorage).mockReturnValue(
        new Promise((resolve) => {
          releaseMode = resolve
        })
      )

      // Deliberately unseeded so the gate has to fetch.
      renderWithProviders(<AppShell>data loaded</AppShell>, {
        secretStorageMode: null
      })

      expect(
        await screen.findByRole('status', { name: 'Loading Squeal' })
      ).toBeInTheDocument()
      expect(screen.queryByText('Welcome to Squeal')).not.toBeInTheDocument()

      releaseMode?.({
        message: null,
        mode: 'keychain',
        storageName: 'the macOS Keychain'
      })

      expect(await screen.findByText('data loaded')).toBeInTheDocument()
    })

    // The ordering guarantee: the gate sits below failIfLoadFailed, so a broken
    // backend can never be mistaken for a first run.
    it('shows the data error screen rather than the consent screen when a load fails', async () => {
      resolveAll()
      vi.mocked(apiClient.getWorksheets).mockRejectedValue(
        new Error('backend is down')
      )

      renderWithProviders(<AppShell>data loaded</AppShell>, {
        secretStorageMode: 'undecided'
      })

      expect(
        await screen.findByText('Could not load your data')
      ).toBeInTheDocument()
      expect(screen.queryByText('Welcome to Squeal')).not.toBeInTheDocument()
    })

    it('asks for the mode alongside the collections, not after them', async () => {
      let releaseWorksheets: ((worksheets: WorksheetDto[]) => void) | undefined

      resolveAll()
      vi.mocked(apiClient.getWorksheets).mockReturnValue(
        new Promise((resolve) => {
          releaseWorksheets = resolve
        })
      )

      renderWithProviders(<AppShell>data loaded</AppShell>, {
        secretStorageMode: null
      })

      await waitFor(() => {
        expect(apiClient.getSecretStorage).toHaveBeenCalled()
      })

      releaseWorksheets?.([worksheet])
    })
  })

  // The reconciliation effect and the tabs slice have to agree about what an
  // empty tab strip means, and only the mounted app shows whether they do: the
  // close is a real click, and the empty state is what the user is left with.
  describe('closing the last tab', () => {
    it('leaves the editor empty instead of reopening the worksheet', async () => {
      resolveAll()

      renderWithProviders(
        <AppShell>
          <App />
        </AppShell>,
        {
          databases: [database],
          openWorksheetId: worksheet.id,
          queries: [],
          worksheets: [worksheet]
        }
      )

      await userEvent.click(
        await screen.findByRole('button', { name: `Close ${worksheet.name}` })
      )

      expect(await screen.findByText('No worksheet open')).toBeInTheDocument()
    })
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
