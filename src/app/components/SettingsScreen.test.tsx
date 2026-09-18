import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvironmentDto } from '@/glue/environments'

import { renderWithProviders } from '../test-utils'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../api-client', () => ({
  apiClient: {
    createEnvironment: vi.fn(),
    deleteEnvironment: vi.fn(async () => undefined),
    getDatabases: vi.fn(async () => []),
    getEnvironments: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getWorksheets: vi.fn(async () => []),
    updateEnvironment: vi.fn()
  }
}))

import { apiClient } from '../api-client'

const environments: EnvironmentDto[] = [
  { createdAt: 1, hue: 152, id: 'local', name: 'Local' },
  { createdAt: 3, hue: 25, id: 'production', name: 'Production' }
]

function renderSettings() {
  return renderWithProviders(<SettingsScreen />, { environments })
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the environments', () => {
    renderSettings()

    expect(
      screen.getAllByLabelText('Environment name').map((input) => {
        return (input as HTMLInputElement).value
      })
    ).toEqual(['Local', 'Production'])
  })

  it('saves a rename when the field is left', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateEnvironment).mockResolvedValue({
      ...environments[1],
      name: 'Live'
    } as EnvironmentDto)

    renderSettings()

    const input = screen.getAllByLabelText('Environment name')[1]

    await user.clear(input)
    await user.type(input, 'Live')
    await user.tab()

    await waitFor(() => {
      expect(apiClient.updateEnvironment).toHaveBeenCalledWith('production', {
        name: 'Live'
      })
    })
  })

  // An empty field is a slip on the way to typing something, not a request to
  // have no name. Sending it would fail the contract and cost the user a toast
  // for something they were in the middle of doing.
  it('puts the name back when the field is emptied', async () => {
    const user = userEvent.setup()

    renderSettings()

    const input = screen.getAllByLabelText('Environment name')[1]

    await user.clear(input)
    await user.tab()

    expect((input as HTMLInputElement).value).toEqual('Production')
    expect(apiClient.updateEnvironment).not.toHaveBeenCalled()
  })

  it('sends only the colour when a swatch is picked', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.updateEnvironment).mockResolvedValue({
      ...environments[1],
      hue: 310
    } as EnvironmentDto)

    renderSettings()

    await user.click(screen.getAllByLabelText('Colour 310')[1])

    await waitFor(() => {
      expect(apiClient.updateEnvironment).toHaveBeenCalledWith('production', {
        hue: 310
      })
    })
  })

  // Deleting an environment is not destructive to the connections using it, so
  // the confirmation says so rather than warning about data loss it does not
  // cause.
  it('asks before deleting, and deletes on confirmation', async () => {
    const user = userEvent.setup()

    renderSettings()

    await user.click(screen.getByLabelText('Delete Production'))

    expect(
      await screen.findByText(
        'Connections using this environment will keep working; they just lose the label.'
      )
    ).toBeInTheDocument()
    expect(apiClient.deleteEnvironment).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(apiClient.deleteEnvironment).toHaveBeenCalledWith('production')
    })
  })
})
