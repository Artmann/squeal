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
import type { DatabaseDto, WorksheetDto } from '@/glue/api/schemas'
import { capturedFetch, jsonResponse } from '../test-fetch'
import { DatabaseForm } from './DatabaseForm'

// The form asks the backend whether the OS keychain can encrypt secrets; stub
// the hook so no test consumes the fetch mocks with a health request.
let encryptionAvailable = true

vi.mock('../hooks/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/queries')>()

  return {
    ...actual,
    useEncryptionAvailable: () => encryptionAvailable
  }
})

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
    encryptionAvailable = true

    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns when the OS keychain cannot encrypt the password', () => {
    encryptionAvailable = false

    renderDatabaseForm()

    expect(
      screen.getByText(
        'Your OS keychain is unavailable — this password will be stored unencrypted on this computer.'
      )
    ).toBeInTheDocument()
  })

  it('does not warn when the OS keychain is available', () => {
    renderDatabaseForm()

    expect(
      screen.queryByText(
        'Your OS keychain is unavailable — this password will be stored unencrypted on this computer.'
      )
    ).not.toBeInTheDocument()
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

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByTestId('connection-success-icon')).toBeInTheDocument()
    })
  })

  it('shows error icon when connection test fails', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: 'Connection refused', success: false })
    )

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

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

      renderDatabaseForm(editProps)

      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      const request = await capturedFetch()
      const body = request.body as {
        connectionInfo: { password: string }
        databaseId: string
      }

      expect(body.databaseId).toEqual('db-123')
      expect(body.connectionInfo.password).toEqual('')
    })

    it('submits without a password', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({
          database: {
            connectionInfo: editProps.defaultValues.connectionInfo,
            createdAt: 1704067200000,
            id: 'db-123',
            name: 'My Database',
            type: 'postgres'
          }
        })
      )

      renderDatabaseForm(editProps)

      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalled()
      })

      const request = await capturedFetch()

      expect(request.url).toContain('/databases/db-123')
      expect(request.method).toEqual('PATCH')
    })
  })

  it('calls onSuccess with database and worksheet when save succeeds', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()

    const database: DatabaseDto = {
      connectionInfo: {
        database: 'testdb',
        host: 'localhost',
        port: 5432,
        username: 'admin'
      },
      createdAt: Date.now(),
      id: '123',
      name: 'My Database',
      sortOrder: null,
      type: 'postgres'
    }

    const updatedWorksheet: WorksheetDto = {
      content: '',
      createdAt: Date.now(),
      databaseId: '123',
      id: 'ws-1',
      lastOpenedAt: null,
      name: 'Worksheet 1',
      sortOrder: null
    }

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ database, updatedWorksheet }, { status: 201 })
    )

    renderDatabaseForm({ onSuccess })

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ database, updatedWorksheet })
    })
  })

  it('shows success toast when save succeeds', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          database: {
            connectionInfo: {
              database: 'testdb',
              host: 'localhost',
              port: 5432,
              username: 'admin'
            },
            createdAt: Date.now(),
            id: '123',
            name: 'My Database',
            sortOrder: null,
            type: 'postgres'
          }
        },
        { status: 201 }
      )
    )

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Database saved!')).toBeInTheDocument()
    })
  })

  it('shows error toast when save fails', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          _tag: 'DatabaseNotFoundError',
          databaseId: '123',
          message: 'Database already exists'
        },
        { status: 404 }
      )
    )

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to save database')).toBeInTheDocument()
    })
  })

  it('displays field-level validation errors from API response', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          _tag: 'HttpApiDecodeError',
          issues: [
            {
              _tag: 'Type',
              message: 'Name is already taken',
              path: ['name']
            },
            {
              _tag: 'Type',
              message: 'Invalid host format',
              path: ['connectionInfo', 'host']
            }
          ],
          message: 'The request payload is invalid'
        },
        { status: 400 }
      )
    )

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Name is already taken')).toBeInTheDocument()
      expect(screen.getByText('Invalid host format')).toBeInTheDocument()
    })
  })

  // Testing a connection skips the form's own validation, so the contract
  // rejects the payload client-side. That has to surface as an inline field
  // error rather than the schema tree ParseError.message renders.
  it('shows an inline field error when testing an incomplete connection', async () => {
    const user = userEvent.setup()

    renderDatabaseForm()

    await user.type(screen.getByLabelText('Name'), 'My Database')
    await user.type(screen.getByLabelText('Username'), 'postgres')
    await user.type(screen.getByLabelText('Password'), 'password')
    await user.type(screen.getByLabelText('Database'), 'mydb')

    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByText('Host is required.')).toBeInTheDocument()
    })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('disables buttons while testing connection', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(jsonResponse({ success: true }))
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

    it('shows SSL Root Certificate field when verify-ca is selected', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Verify CA' }))

      expect(screen.getByLabelText('SSL Root Certificate')).toBeInTheDocument()
    })

    it('explains that require does not verify the server identity', async () => {
      const user = userEvent.setup()

      renderDatabaseForm()

      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Require' }))

      expect(
        screen.getByText(
          "Encrypts traffic but does not verify the server's identity."
        )
      ).toBeInTheDocument()
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

      const database: DatabaseDto = {
        connectionInfo: {
          database: 'testdb',
          host: 'localhost',
          port: 5432,
          username: 'admin'
        },
        createdAt: Date.now(),
        id: '123',
        name: 'My Database',
        sortOrder: null,
        type: 'postgres'
      }

      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ database }, { status: 201 })
      )

      renderDatabaseForm({ onSuccess })

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: /advanced/i }))
      await user.click(screen.getByRole('combobox', { name: /ssl mode/i }))
      await user.click(screen.getByRole('option', { name: 'Verify Full' }))
      await user.type(screen.getByLabelText('SSL Root Certificate'), 'system')
      await user.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetch).toHaveBeenCalled()
      })

      const body = (await capturedFetch()).body as {
        connectionInfo: { sslMode: string; sslRootCert: string }
      }

      expect(body.connectionInfo.sslMode).toEqual('verify-full')
      expect(body.connectionInfo.sslRootCert).toEqual('system')
    })
  })

  it('disables buttons while saving', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              jsonResponse(
                {
                  database: {
                    connectionInfo: { path: '/tmp/test.sqlite3' },
                    createdAt: Date.now(),
                    id: '123',
                    name: 'My Database',
                    sortOrder: null,
                    type: 'postgres'
                  }
                },
                { status: 201 }
              )
            )
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
