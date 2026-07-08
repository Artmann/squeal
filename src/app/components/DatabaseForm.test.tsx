import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import { createCollections } from '../collections'
import { CollectionsProvider } from '../collections-context'
import { DatabaseForm } from './DatabaseForm'

// Radix UI Select uses DOM APIs not available in jsdom
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof window.ResizeObserver
})

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

function renderDatabaseForm(props: Parameters<typeof DatabaseForm>[0] = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false }
    }
  })

  const collections = createCollections(queryClient)

  return render(
    <QueryClientProvider client={queryClient}>
      <CollectionsProvider collections={collections}>
        <DatabaseForm {...props} />
        <Toaster />
      </CollectionsProvider>
    </QueryClientProvider>
  )
}

describe('DatabaseForm', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders all form fields', () => {
    renderDatabaseForm()

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

  it('does not render cancel button when onCancel is not provided', () => {
    renderDatabaseForm()

    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
  })

  it('renders cancel button when onCancel is provided', () => {
    renderDatabaseForm({ onCancel: vi.fn() })

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  describe('connection string paste', () => {
    it('fills fields from a pasted connection string', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /paste it/i }))
      await user.type(
        screen.getByPlaceholderText(/postgresql:\/\//),
        'postgresql://alice:secret@db.example.com:6543/analytics'
      )
      await user.click(screen.getByRole('button', { name: 'Fill in' }))

      expect(screen.getByLabelText('Host')).toHaveValue('db.example.com')
      expect(screen.getByLabelText('Port')).toHaveValue(6543)
      expect(screen.getByLabelText('Database')).toHaveValue('analytics')
      expect(screen.getByLabelText('Username')).toHaveValue('alice')
      expect(screen.getByLabelText('Password')).toHaveValue('secret')
    })
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    renderDatabaseForm({ onCancel })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows success icon when connection test succeeds', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true }),
      ok: true
    } as Response)

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-success-icon')).toBeInTheDocument()
    })
  })

  it('shows error icon when connection test fails', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({ message: 'Connection refused', success: false }),
      ok: true
    } as Response)

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-error-icon')).toBeInTheDocument()
    })
  })

  describe('edit mode', () => {
    const editProps = {
      databaseId: 'db-123',
      defaultValues: {
        connectionInfo: {
          database: 'mydb',
          host: 'localhost',
          port: 5432,
          username: 'postgres'
        },
        name: 'My Database',
        type: 'postgres' as const
      }
    }

    it('sends the databaseId when testing a connection without a password', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true }),
        ok: true
      } as Response)

      renderDatabaseForm(editProps)

      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      const [, requestOptions] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse(String(requestOptions?.body))

      expect(body.databaseId).toEqual('db-123')
      expect(body.connectionInfo.password).toEqual('')
    })

    it('submits without a password', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            database: {
              connectionInfo: editProps.defaultValues.connectionInfo,
              createdAt: 1704067200000,
              id: 'db-123',
              name: 'My Database',
              type: 'postgres'
            }
          }),
        ok: true
      } as Response)

      renderDatabaseForm(editProps)

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalled()
      })

      const [url, requestOptions] = vi.mocked(fetch).mock.calls[0]

      expect(String(url)).toContain('/databases/db-123')
      expect(requestOptions?.method).toEqual('PATCH')
    })
  })

  it('calls onSuccess with database and worksheet when save succeeds', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()

    const database = {
      connectionInfo: {},
      createdAt: Date.now(),
      id: '123',
      name: 'My Database',
      type: 'postgres'
    }

    const updatedWorksheet = {
      createdAt: Date.now(),
      databaseId: '123',
      id: 'ws-1',
      name: 'Worksheet 1'
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ database, updatedWorksheet }),
      ok: true
    } as Response)

    renderDatabaseForm({ onSuccess })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ database, updatedWorksheet })
    })
  })

  it('shows success toast when save succeeds', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () =>
        Promise.resolve({
          database: {
            connectionInfo: {},
            createdAt: Date.now(),
            id: '123',
            name: 'My Database',
            type: 'postgres'
          }
        }),
      ok: true
    } as Response)

    renderDatabaseForm()

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
        }),
      ok: true
    } as Response)

    renderDatabaseForm()

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
            details: {
              connectionInfo: {
                host: 'Invalid host format'
              },
              name: 'Name is already taken'
            },
            message: 'Validation failed',
            status: 400
          }
        }),
      ok: true
    } as Response)

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Name is already taken')).toBeInTheDocument()
      expect(screen.getByText('Invalid host format')).toBeInTheDocument()
    })
  })

  it('disables buttons while testing connection', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              json: () => Promise.resolve({ success: true }),
              ok: true
            } as Response)
          }, 100)
        })
    )

    renderDatabaseForm({ onCancel: vi.fn() })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    expect(
      screen.getByRole('button', { name: 'Test Connection' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  describe('SSL section', () => {
    it('renders SSL mode dropdown for postgres', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /advanced/i }))

      expect(screen.getByText('SSL')).toBeInTheDocument()
      expect(
        screen.getByRole('combobox', { name: /ssl mode/i })
      ).toBeInTheDocument()
    })

    it('does not render SSL Root Certificate field by default', () => {
      renderDatabaseForm()

      expect(
        screen.queryByLabelText('SSL Root Certificate')
      ).not.toBeInTheDocument()
    })

    it('shows SSL Root Certificate field when verify-full is selected', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Verify Full' }))

      expect(screen.getByLabelText('SSL Root Certificate')).toBeInTheDocument()
    })

    it('hides SSL Root Certificate field when switching away from verify-full', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Verify Full' }))

      expect(screen.getByLabelText('SSL Root Certificate')).toBeInTheDocument()

      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Require' }))

      expect(
        screen.queryByLabelText('SSL Root Certificate')
      ).not.toBeInTheDocument()
    })

    it('includes ssl fields in the save payload', async () => {
      const user = userEvent.setup()
      const onSuccess = vi.fn()

      const database = {
        connectionInfo: {},
        createdAt: Date.now(),
        id: '123',
        name: 'My Database',
        type: 'postgres'
      }

      vi.mocked(fetch).mockResolvedValueOnce({
        json: () => Promise.resolve({ database }),
        ok: true
      } as Response)

      renderDatabaseForm({ onSuccess })

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Verify Full' }))
      await user.type(screen.getByLabelText('SSL Root Certificate'), 'system')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        const body = JSON.parse(
          (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
        )

        expect(body.connectionInfo.sslMode).toEqual('verify-full')
        expect(body.connectionInfo.sslRootCert).toEqual('system')
      })
    })
  })

  it('disables buttons while saving', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              json: () =>
                Promise.resolve({
                  database: {
                    connectionInfo: {},
                    createdAt: Date.now(),
                    id: '123',
                    name: 'My Database',
                    type: 'postgres'
                  }
                }),
              ok: true
            } as Response)
          }, 100)
        })
    )

    renderDatabaseForm({ onCancel: vi.fn() })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      screen.getByRole('button', { name: 'Test Connection' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
