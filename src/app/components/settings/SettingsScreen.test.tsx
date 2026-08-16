import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CompletionStatusResponse,
  ModelDownloadResponse,
  SettingsResponse
} from '@/glue/api/schemas'
import {
  completionMessages,
  downloadMessages,
  suggestedModel
} from '@/glue/completions'

import { renderWithProviders } from '../../test-utils'
import { SettingsScreen } from './SettingsScreen'

vi.mock('../../api-client', () => ({
  apiClient: {
    cancelModelDownload: vi.fn(),
    getCompletionStatus: vi.fn(),
    getModelDownload: vi.fn(),
    getSettings: vi.fn(),
    startModelDownload: vi.fn(),
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
  reachable: true,
  selectedModel: suggestedModel
}

const unreachableStatus: CompletionStatusResponse = {
  available: false,
  enabled: true,
  message: completionMessages.unreachable('127.0.0.1:11434'),
  models: [],
  reachable: false,
  selectedModel: null
}

const noModelsStatus: CompletionStatusResponse = {
  ...unreachableStatus,
  message: completionMessages.noModels,
  reachable: true
}

const idleDownload: ModelDownloadResponse = {
  message: '',
  model: null,
  percent: 0,
  state: 'idle'
}

const runningDownload: ModelDownloadResponse = {
  message: 'pulling 4c1b0e1e1b0f',
  model: suggestedModel,
  percent: 42,
  state: 'downloading'
}

const downloadButtonName = `Download ${suggestedModel} (~1 GB)`

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(apiClient.cancelModelDownload).mockResolvedValue(idleDownload)
  vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(workingStatus)
  vi.mocked(apiClient.getModelDownload).mockResolvedValue(idleDownload)
  vi.mocked(apiClient.getSettings).mockResolvedValue(enabledSettings)
  vi.mocked(apiClient.startModelDownload).mockResolvedValue(runningDownload)
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
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(noModelsStatus)

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.noModels)
    ).toBeInTheDocument()
  })

  it('offers to download the suggested model when none are installed', async () => {
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(noModelsStatus)

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByRole('button', { name: downloadButtonName })
    ).toBeInTheDocument()
  })

  it('does not offer a download when Ollama cannot be reached', async () => {
    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(
      unreachableStatus
    )

    renderWithProviders(<SettingsScreen />)

    expect(
      await screen.findByText(completionMessages.unreachable('127.0.0.1:11434'))
    ).toBeInTheDocument()

    expect(
      screen.queryByRole('button', { name: downloadButtonName })
    ).not.toBeInTheDocument()
  })

  it('shows progress once the download has started', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(noModelsStatus)

    renderWithProviders(<SettingsScreen />)

    await user.click(
      await screen.findByRole('button', { name: downloadButtonName })
    )

    expect(apiClient.startModelDownload).toHaveBeenCalledOnce()

    const progress = await screen.findByRole('progressbar', {
      name: `Downloading ${suggestedModel}`
    })

    expect(progress).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('pulling 4c1b0e1e1b0f')).toBeInTheDocument()
  })

  it('cancels a running download', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(noModelsStatus)
    vi.mocked(apiClient.getModelDownload).mockResolvedValue(runningDownload)

    renderWithProviders(<SettingsScreen />)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(apiClient.cancelModelDownload).toHaveBeenCalledOnce()

    expect(
      await screen.findByRole('button', { name: downloadButtonName })
    ).toBeInTheDocument()
  })

  it('explains a download that failed and offers it again', async () => {
    const message = downloadMessages.failed(
      suggestedModel,
      'Ollama answered with 500.'
    )

    vi.mocked(apiClient.getCompletionStatus).mockResolvedValue(noModelsStatus)
    vi.mocked(apiClient.getModelDownload).mockResolvedValue({
      message,
      model: suggestedModel,
      percent: 12,
      state: 'error'
    })

    renderWithProviders(<SettingsScreen />)

    expect(await screen.findByText(message)).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: downloadButtonName })
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
