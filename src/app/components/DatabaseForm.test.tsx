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
import type {
  DatabaseDto,
  SecretStorageMode,
  WorksheetDto
} from '@/glue/api/schemas'
import { capturedFetch, jsonResponse } from '../test-fetch'
import { DatabaseForm } from './DatabaseForm'

// The form reads whether stored passwords are encrypted; stub the hook so no
// test consumes the fetch mocks with a secret-storage request (and so none of
// them suspend without a boundary).
let secretStorageMode: SecretStorageMode = 'keychain'

const storageName = 'the macOS Keychain'

vi.mock('../hooks/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/queries')>()

  return {
    ...actual,
    useSecretStorage: () => ({
      message: null,
      mode: secretStorageMode,
      storageName
    })
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

const unencryptedWarning =
  'This password will be stored unencrypted on this computer, because Squeal does not have permission to use the macOS Keychain.'

describe('DatabaseForm', () => {
  beforeEach(() => {
    secretStorageMode = 'keychain'

    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns when the password will be stored unencrypted', () => {
    secretStorageMode = 'plaintext'

    renderDatabaseForm()

    expect(screen.getByText(unencryptedWarning)).toBeInTheDocument()
  })

  it('says nothing about encryption when the keychain is in use', () => {
    renderDatabaseForm()

    expect(screen.queryByText(unencryptedWarning)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Turn on encryption' })
    ).not.toBeInTheDocument()
  })

  it('offers to turn encryption on from the warning', async () => {
    const user = userEvent.setup()

    secretStorageMode = 'plaintext'

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ message: null, mode: 'keychain', storageName })
    )

    renderDatabaseForm()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    await waitFor(() => {
      expect(screen.getByText('Encryption is on')).toBeInTheDocument()
    })

    const request = await capturedFetch()

    expect(request.method).toEqual('POST')
    expect(request.url).toEqual('http://127.0.0.1:7847/secret-storage/grant')
  })

  // Permission granted and nothing encrypted is the one outcome that used to
  // read as a success: the mode is `keychain`, so the old check announced that
  // every saved password was now encrypted while all of them were still
  // plaintext.
  it('says so when permission was granted but nothing could be encrypted', async () => {
    const user = userEvent.setup()

    secretStorageMode = 'plaintext'

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        message:
          'Squeal has permission to use the macOS Keychain, but it refused to encrypt.',
        mode: 'keychain',
        storageName
      })
    )

    renderDatabaseForm()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    await waitFor(() => {
      expect(
        screen.getByText('Encryption is on, but some passwords are not')
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Squeal has permission to use the macOS Keychain, but it refused to encrypt.'
        )
      ).toBeInTheDocument()
    })

    expect(screen.queryByText('Encryption is on')).not.toBeInTheDocument()
  })

  it('explains why turning encryption on did not work', async () => {
    const user = userEvent.setup()

    secretStorageMode = 'plaintext'

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        message: 'Squeal could not get access to the macOS Keychain.',
        mode: 'undecided',
        storageName
      })
    )

    renderDatabaseForm()

    await user.click(screen.getByRole('button', { name: 'Turn on encryption' }))

    await waitFor(() => {
      expect(
        screen.getByText('Could not turn on encryption')
      ).toBeInTheDocument()
      expect(
        screen.getByText('Squeal could not get access to the macOS Keychain.')
      ).toBeInTheDocument()
    })
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

  // A test result describes the connection values it was produced from. Once
  // those change it is no longer about anything the form is holding, so it must
  // stop being shown rather than assert a connection that was never tried.
  describe('connection test invalidation', () => {
    it('clears the success icon when the host changes', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

      renderDatabaseForm()

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText('Host'), '.invalid')

      await waitFor(() => {
        expect(
          screen.queryByTestId('connection-success-icon')
        ).not.toBeInTheDocument()
      })
    })

    it('clears the error icon when the failing field is fixed', async () => {
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

      const portInput = screen.getByLabelText('Port')
      await user.clear(portInput)
      await user.type(portInput, '5433')

      await waitFor(() => {
        expect(
          screen.queryByTestId('connection-error-icon')
        ).not.toBeInTheDocument()
      })
    })

    // The display name is not part of the connection, so renaming the entry
    // does not invalidate a result.
    it('keeps the success icon when only the display name changes', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

      renderDatabaseForm()

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText('Name'), ' (staging)')

      expect(screen.getByTestId('connection-success-icon')).toBeInTheDocument()
    })

    // The values can change while the request is in flight — the fields are not
    // disabled — so the verdict has to be dropped on arrival, not just hidden.
    // The toast is part of that: it names the host that was tested.
    it('drops a verdict that arrives after the connection changed', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(jsonResponse({ success: true }))
            }, 50)
          })
      )

      renderDatabaseForm()

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await user.type(screen.getByLabelText('Host'), '.invalid')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Test Connection' })
        ).toBeEnabled()
      })

      expect(
        screen.queryByTestId('connection-success-icon')
      ).not.toBeInTheDocument()
      expect(
        screen.queryByText('Connection successful!')
      ).not.toBeInTheDocument()
    })

    // The testing flag is cleared in a `finally`, so nothing thrown while
    // handling the response can leave the form stuck behind a spinner with
    // Test, Save and Cancel all disabled.
    it('re-enables the form when the test throws', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockRejectedValueOnce(new Error('network is down'))

      renderDatabaseForm({ onCancel: vi.fn() })

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Test Connection' })
        ).toBeEnabled()
      })

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    })

    // Retired by value, not by a generation counter, so undoing the edit brings
    // the verdict back — it is still true of what the form holds.
    it('shows the verdict again when the edit is undone', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

      renderDatabaseForm()

      await fillForm(user)
      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      const host = screen.getByLabelText('Host')

      await user.type(host, 'x')

      expect(
        screen.queryByTestId('connection-success-icon')
      ).not.toBeInTheDocument()

      await user.clear(host)
      await user.type(host, 'localhost')

      expect(screen.getByTestId('connection-success-icon')).toBeInTheDocument()
    })

    // Changing the type replaces every connection field, so the result stops
    // applying. This is what the deleted explicit reset used to cover.
    it('clears the error icon when the database type changes', async () => {
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

      // The type select has no accessible name; it is the first combobox, and
      // its trigger shows the current type.
      const [typeSelect] = screen.getAllByRole('combobox')

      expect(typeSelect).toHaveTextContent('PostgreSQL')

      await user.click(typeSelect)
      await user.click(screen.getByRole('option', { name: 'MySQL' }))

      await waitFor(() => {
        expect(
          screen.queryByTestId('connection-error-icon')
        ).not.toBeInTheDocument()
      })
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

    // The blank password field is what borrows the stored one, so typing a
    // password sends a different credential than the one that passed.
    it('clears the success icon when a password is typed', async () => {
      const user = userEvent.setup()

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }))

      renderDatabaseForm(editProps)

      await user.click(screen.getByRole('button', { name: 'Test Connection' }))

      await waitFor(() => {
        expect(
          screen.getByTestId('connection-success-icon')
        ).toBeInTheDocument()
      })

      await user.type(screen.getByLabelText('Password'), 'a-new-password')

      await waitFor(() => {
        expect(
          screen.queryByTestId('connection-success-icon')
        ).not.toBeInTheDocument()
      })
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

  // The API client flattens issue paths into dotted keys ('connectionInfo.host'),
  // so this asserts the dotted key reaches the nested field itself rather than
  // merely rendering the message somewhere on the form.
  it('attaches a dotted field error to the nested input it names', async () => {
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
      expect(screen.getByLabelText('Host')).toHaveAccessibleDescription(
        'Invalid host format'
      )
    })

    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      'Name is already taken'
    )
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
