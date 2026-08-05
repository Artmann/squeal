import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SecretStorageResponse } from '@/glue/api/schemas'

import { queryKeys } from '../query-keys'
import { renderWithProviders } from '../test-utils'
import { SecretStorageConsentScreen } from './SecretStorageConsentScreen'

vi.mock('../api-client', () => ({
  apiClient: {
    grantSecretStorage: vi.fn(),
    skipSecretStorage: vi.fn()
  }
}))

import { apiClient } from '../api-client'

const storageName = 'the macOS Keychain'

const granted: SecretStorageResponse = {
  message: null,
  mode: 'keychain',
  storageName
}

const refused: SecretStorageResponse = {
  message:
    'Squeal could not get access to the macOS Keychain. If your system asked for permission, choose Allow and try again — or skip and save your passwords unencrypted.',
  mode: 'undecided',
  storageName
}

const skipped: SecretStorageResponse = {
  message: null,
  mode: 'plaintext',
  storageName
}

function renderScreen() {
  return renderWithProviders(
    <SecretStorageConsentScreen storageName={storageName} />
  )
}

beforeEach(() => {
  vi.clearAllMocks()

  vi.mocked(apiClient.grantSecretStorage).mockResolvedValue(granted)
  vi.mocked(apiClient.skipSecretStorage).mockResolvedValue(skipped)
})

describe('SecretStorageConsentScreen', () => {
  it('explains what permission is for', () => {
    renderScreen()

    expect(screen.getByText('Welcome to Squeal')).toBeInTheDocument()
    expect(
      screen.getByText(/needs your permission to use the macOS Keychain/)
    ).toBeInTheDocument()
  })

  it('focuses the encryption button so a keyboard user starts there', () => {
    renderScreen()

    expect(
      screen.getByRole('button', { name: 'Turn on encryption' })
    ).toHaveFocus()
  })

  // The regression test for the whole feature: nothing may reach the OS keychain
  // until the user asks for it, and StrictMode double-invokes effects, so a probe
  // fired from one would raise two prompts on first paint.
  it('never touches the keychain without a click, even under StrictMode', () => {
    renderWithProviders(
      <StrictMode>
        <SecretStorageConsentScreen storageName={storageName} />
      </StrictMode>
    )

    expect(apiClient.grantSecretStorage).not.toHaveBeenCalled()
    expect(apiClient.skipSecretStorage).not.toHaveBeenCalled()
  })

  it('asks the keychain once and locks the screen while it waits', async () => {
    const user = userEvent.setup()

    let release: ((response: SecretStorageResponse) => void) | undefined

    vi.mocked(apiClient.grantSecretStorage).mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )

    renderScreen()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    expect(apiClient.grantSecretStorage).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: /Waiting for permission/ })
    ).toBeDisabled()
    // Disabled too: two concurrent writes to one decision could let the late
    // probe overturn an explicit skip.
    expect(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    ).toBeDisabled()
    expect(screen.getByRole('status')).toBeInTheDocument()

    release?.(granted)

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Waiting for permission/ })
      ).not.toBeInTheDocument()
    })
  })

  it('records the granted mode so the app can move on', async () => {
    const user = userEvent.setup()

    const { queryClient } = renderScreen()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.secretStorage)).toEqual(granted)
    })
  })

  it('explains a refused prompt and offers to try again', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.grantSecretStorage).mockResolvedValue(refused)

    renderScreen()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /Squeal could not get access to the macOS Keychain/
      )
    })

    const tryAgain = screen.getByRole('button', { name: 'Try again' })

    // Focus comes back, because disabling a focused button drops it to the body.
    expect(tryAgain).toHaveFocus()
    expect(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    ).toBeInTheDocument()
  })

  it('asks for confirmation before skipping', async () => {
    const user = userEvent.setup()

    renderScreen()

    await user.click(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    )

    expect(screen.getByText('Save passwords unencrypted?')).toBeInTheDocument()
    expect(apiClient.skipSecretStorage).not.toHaveBeenCalled()
  })

  it('records the choice once it is confirmed', async () => {
    const user = userEvent.setup()

    const { queryClient } = renderScreen()

    await user.click(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    )
    await user.click(screen.getByRole('button', { name: 'Save unencrypted' }))

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.secretStorage)).toEqual(skipped)
    })

    expect(apiClient.skipSecretStorage).toHaveBeenCalledTimes(1)
  })

  it('leaves the choice unmade when the confirmation is dismissed', async () => {
    const user = userEvent.setup()

    renderScreen()

    await user.click(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    )
    await user.click(screen.getByRole('button', { name: 'Go back' }))

    expect(
      screen.queryByText('Save passwords unencrypted?')
    ).not.toBeInTheDocument()
    expect(apiClient.skipSecretStorage).not.toHaveBeenCalled()
  })

  it('cancels the confirmation on Escape without dismissing the screen', async () => {
    const user = userEvent.setup()

    renderScreen()

    await user.click(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    )
    await user.keyboard('{Escape}')

    expect(
      screen.queryByText('Save passwords unencrypted?')
    ).not.toBeInTheDocument()
    // There is no state behind this screen to return to, so Escape must never
    // dismiss it.
    expect(screen.getByText('Welcome to Squeal')).toBeInTheDocument()
  })

  it('keeps the skip available after the keychain refuses', async () => {
    const user = userEvent.setup()

    vi.mocked(apiClient.grantSecretStorage).mockResolvedValue(refused)

    renderScreen()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    await user.click(
      screen.getByRole('button', {
        name: 'Skip and save passwords unencrypted'
      })
    )
    await user.click(screen.getByRole('button', { name: 'Save unencrypted' }))

    expect(apiClient.skipSecretStorage).toHaveBeenCalledTimes(1)
  })
})
