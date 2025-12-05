import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatabaseForm } from './DatabaseForm'

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
  return render(
    <>
      <DatabaseForm {...props} />
      <Toaster />
    </>
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

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()

    renderDatabaseForm({ onCancel })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows success alert when connection test succeeds', async () => {
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValueOnce({
      json: () => Promise.resolve({ success: true }),
      ok: true
    } as Response)

    renderDatabaseForm()

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
        Promise.resolve({ message: 'Connection refused', success: false }),
      ok: true
    } as Response)

    renderDatabaseForm()

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Test Connection' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Unable to connect to your database.'
      )
      expect(screen.getByRole('alert')).toHaveTextContent('Connection refused')
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

    expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
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
