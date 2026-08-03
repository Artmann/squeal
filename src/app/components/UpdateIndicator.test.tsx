import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UpdateStatusResponse } from '@/glue/api/schemas'

import { renderWithProviders } from '../test-utils'
import { UpdateIndicator } from './UpdateIndicator'

vi.mock('../api-client', () => ({
  apiClient: {
    getUpdateStatus: vi.fn(),
    installUpdate: vi.fn()
  }
}))

import { apiClient } from '../api-client'

const readyStatus: UpdateStatusResponse = {
  currentVersion: '1.2.0',
  lastCheckedAt: 1_700_000_000_000,
  message: null,
  releaseNotesUrl: 'https://github.com/Artmann/squeal/releases/tag/v1.3.0',
  state: 'ready',
  version: '1.3.0'
}

const availableStatus: UpdateStatusResponse = {
  ...readyStatus,
  message:
    'Squeal cannot update itself on Linux. Download the latest .deb or .rpm from the release page.',
  state: 'available'
}

beforeEach(() => {
  vi.clearAllMocks()

  // The seeded cache answers the first render; this covers the refetch the
  // 60-second poller would otherwise fire at a mock with no implementation.
  vi.mocked(apiClient.getUpdateStatus).mockResolvedValue(readyStatus)
  vi.mocked(apiClient.installUpdate).mockResolvedValue(readyStatus)
})

describe('UpdateIndicator', () => {
  it('renders nothing while no status has loaded', () => {
    renderWithProviders(<UpdateIndicator />)

    expect(
      screen.queryByRole('button', { name: 'Update available' })
    ).not.toBeInTheDocument()
  })

  it.each([
    ['idle' as const],
    ['checking' as const],
    ['downloading' as const],
    ['error' as const],
    ['unsupported' as const]
  ])('renders nothing when the state is %s', (state) => {
    renderWithProviders(<UpdateIndicator />, {
      updateStatus: { ...readyStatus, state }
    })

    expect(
      screen.queryByRole('button', { name: 'Update available' })
    ).not.toBeInTheDocument()
  })

  it('shows the icon once an update is ready', () => {
    renderWithProviders(<UpdateIndicator />, { updateStatus: readyStatus })

    expect(
      screen.getByRole('button', { name: 'Update available' })
    ).toBeInTheDocument()
  })

  it('names the version and offers a restart', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UpdateIndicator />, { updateStatus: readyStatus })

    await user.click(screen.getByRole('button', { name: 'Update available' }))

    expect(screen.getByText('Squeal 1.3.0 is ready')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Squeal will restart to finish installing. This takes a moment.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Release notes' })).toHaveAttribute(
      'href',
      'https://github.com/Artmann/squeal/releases/tag/v1.3.0'
    )
  })

  it('installs the update when the restart button is clicked', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UpdateIndicator />, { updateStatus: readyStatus })

    await user.click(screen.getByRole('button', { name: 'Update available' }))
    await user.click(screen.getByRole('button', { name: 'Restart to update' }))

    expect(apiClient.installUpdate).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled()
    })
  })

  it('explains a failed install without hiding the popover', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.installUpdate).mockRejectedValue(
      new Error('UpdateNotReadyError')
    )

    renderWithProviders(<UpdateIndicator />, { updateStatus: readyStatus })

    await user.click(screen.getByRole('button', { name: 'Update available' }))
    await user.click(screen.getByRole('button', { name: 'Restart to update' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'The update could not be started. Try again, or download it from the release page.'
        )
      ).toBeInTheDocument()
    })
  })

  it('offers the release page instead of a restart when it cannot self-install', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UpdateIndicator />, { updateStatus: availableStatus })

    await user.click(screen.getByRole('button', { name: 'Update available' }))

    expect(screen.getByText('Squeal 1.3.0 is available')).toBeInTheDocument()
    expect(screen.getByText(availableStatus.message ?? '')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open release page' })
    ).toHaveAttribute(
      'href',
      'https://github.com/Artmann/squeal/releases/tag/v1.3.0'
    )
    expect(
      screen.queryByRole('button', { name: 'Restart to update' })
    ).not.toBeInTheDocument()
  })

  it('falls back to a generic heading when the version is unreadable', async () => {
    const user = userEvent.setup()

    renderWithProviders(<UpdateIndicator />, {
      updateStatus: { ...readyStatus, version: null }
    })

    await user.click(screen.getByRole('button', { name: 'Update available' }))

    expect(screen.getByText('An update is ready')).toBeInTheDocument()
  })
})
