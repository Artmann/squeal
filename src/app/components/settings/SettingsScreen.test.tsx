import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CompletionStatusResponse,
  SettingsResponse
} from '@/glue/api/schemas'
import { completionMessages, suggestedModel } from '@/glue/completions'

import { renderWithProviders } from '../../test-utils'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../../api-client', () => ({
  apiClient: {
    getCompletionStatus: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn()
  }
}))

import { apiClient } from '../../api-client'

const enabledSettings: SettingsResponse = {
  aiCompletionModel: null,
  aiCompletionsEnabled: true
}

const workingStatus: CompletionStatusResponse = {
  available: true,
  enabled: true,
  message: completionMessages.using(suggestedModel),
  models: [suggestedModel, 'llama3.2:3b'],
  selectedModel: suggestedModel
}

const unreachableStatus: CompletionStatusResponse = {
  available: false,
  enabled: true,
  message: completionMessages.unreachable('127.0.0.1:11434'),
  models: [],
  selectedModel: null
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(workingStatus)
  vi.mocked(apiClient.getSettings).mockResolvedValue(enabledSettings)
  vi.mocked(apiClient.updateSettings).mockResolvedValue(enabledSettings)
})

describe('SettingsScreen', () => {
  it('tells the user how to accept a suggestion', async () => {
    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(
        'Tab to accept · ⌘→ for one word · Esc to dismiss'
      )
    ).toBeInTheDocument()
  })

  it('names the model in use when Ollama is running', async () => {
    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.using(suggestedModel))
    ).toBeInTheDocument()
  })

  it('explains how to install Ollama when it cannot be reached', async () => {
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(
      unreachableStatus
    )

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.unreachable('127.0.0.1:11434'))
    ).toBeInTheDocument()
  })

  it('explains how to pull a model when none are installed', async () => {
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue({
      ...unreachableStatus,
      available: true,
      message: completionMessages.noModels
    })

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.noModels)
    ).toBeInTheDocument()
  })

  it('names the missing model when the stored one was removed', async () => {
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue({
      ...workingStatus,
      message: completionMessages.modelMissing('codellama:7b'),
      selectedModel: null
    })

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.modelMissing('codellama:7b'))
    ).toBeInTheDocument()
  })

  it('says the check is still running before the status arrives', () => {
    renderWithProviders(<SettingsScreen />)

    expect(
      screen.getByText('Checking whether Ollama is running…')
    ).toBeInTheDocument()
  })

  it('turns suggestions off', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SettingsScreen />)

    const toggle = await screen.findByRole('switch', {
      name: 'Suggest completions as I type'
    })

    await waitFor(() => {
      expect(toggle).toBeEnabled()
    })

    await user.click(toggle)

    expect(apiClient.updateSettings).toHaveBeenCalledWith({
      aiCompletionsEnabled: false
    })
  })

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<SettingsScreen />, {
      ui: { settingsOpen: true }
    })

    await user.click(screen.getByRole('button', { name: 'Close settings' }))

    expect(store.getState().ui).toEqual({ settingsOpen: false })
  })

  it('closes when escape is pressed', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<SettingsScreen />, {
      ui: { settingsOpen: true }
    })

    await user.keyboard('{Escape}')

    expect(store.getState().ui).toEqual({ settingsOpen: false })
  })
})
