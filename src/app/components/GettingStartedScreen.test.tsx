import { configureStore } from '@reduxjs/toolkit'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import editorReducer from '../store/editor-slice'
import uiReducer from '../store/ui-slice'
import { GettingStartedScreen } from './GettingStartedScreen'

function TestEnvironment({ children }: { children: ReactNode }) {
  const store = configureStore({
    reducer: {
      editor: editorReducer,
      ui: uiReducer
    },
    preloadedState: {
      editor: { databases: [], queries: [], worksheets: [] },
      ui: { showGettingStartedScreen: true }
    }
  })

  return (
    <Provider store={store}>
      {children}
      <Toaster />
    </Provider>
  )
}

function renderGettingStartedScreen() {
  return render(
    <TestEnvironment>
      <GettingStartedScreen />
    </TestEnvironment>
  )
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'My Database')
  await user.type(screen.getByLabelText('Host'), 'localhost')

  const portInput = screen.getByLabelText('Port')
  await user.clear(portInput)
  await user.type(portInput, '5432')

  await user.type(screen.getByLabelText('Username'), 'postgres')
  await user.type(screen.getByLabelText('Password'), 'password')
  await user.type(screen.getByLabelText('Database'), 'mydb')
}

describe('GettingStartedScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the welcome screen with form fields', () => {
    renderGettingStartedScreen()

    expect(screen.getByText('Welcome 👋')).toBeInTheDocument()
    expect(
      screen.getByText('Connect your first database to get started.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Database')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Test Connection' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('shows success alert when connection test succeeds', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true })
    } as Response)

    renderGettingStartedScreen()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(
        screen.getByText('Success! We were able to connect to your database.')
      ).toBeInTheDocument()
    })
  })

  it('shows error alert when connection test fails', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({ success: false, message: 'Connection refused' })
    } as Response)

    renderGettingStartedScreen()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to connect to your database.'
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Connection refused')
    })
  })

  it('saves database and shows success toast', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          database: {
            id: '123',
            name: 'My Database',
            type: 'postgres',
            createdAt: Date.now(),
            connectionInfo: {}
          }
        })
    } as Response)

    renderGettingStartedScreen()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Database saved!')).toBeInTheDocument()
    })
  })

  it('shows error toast when save fails', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          error: {
            message: 'Database already exists',
            status: 400
          }
        })
    } as Response)

    renderGettingStartedScreen()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save database')).toBeInTheDocument()
    })
  })

  it('displays field-level validation errors from API response', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          error: {
            message: 'Validation failed',
            status: 400,
            details: {
              name: 'Name is already taken',
              connectionInfo: {
                host: 'Invalid host format'
              }
            }
          }
        })
    } as Response)

    renderGettingStartedScreen()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Name is already taken')).toBeInTheDocument()
      expect(screen.getByText('Invalid host format')).toBeInTheDocument()
    })
  })
})
