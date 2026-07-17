import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { DatabaseDto } from '@/glue/databases'

import { renderWithProviders } from '../test-utils'
import { EditorScreen } from './EditorScreen'

// Radix UI Select (used by DatabaseForm) needs DOM APIs missing in jsdom.
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

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'testdb',
    host: 'localhost',
    port: 5432,
    username: 'admin'
  },
  createdAt: 1704067200000,
  id: 'db-123',
  name: 'Test Database',
  sortOrder: null,
  type: 'postgres'
}

describe('EditorScreen', () => {
  describe('edit mode', () => {
    it('renders the edit database header', () => {
      renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />,
        { databases: [testDatabase] }
      )

      expect(screen.getByText('Edit database')).toBeInTheDocument()
    })

    it('pre-populates the form with the database values', () => {
      renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />,
        { databases: [testDatabase] }
      )

      expect(screen.getByLabelText('Name')).toHaveValue('Test Database')
      expect(screen.getByLabelText('Host')).toHaveValue('localhost')
      expect(screen.getByLabelText('Port')).toHaveValue(5432)
      expect(screen.getByLabelText('Username')).toHaveValue('admin')
      expect(screen.getByLabelText('Database')).toHaveValue('testdb')

      // Passwords are never returned to the renderer — the field starts
      // empty and hints that leaving it blank keeps the stored one.
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Password')).toHaveAttribute(
        'placeholder',
        'Leave blank to keep current password'
      )
    })

    it('shows a not-found message for an unknown database id', () => {
      renderWithProviders(
        <EditorScreen
          databaseId="nonexistent"
          mode="edit"
        />,
        { databases: [] }
      )

      expect(screen.getByText('Database not found.')).toBeInTheDocument()
    })

    it('closes the editor screen when the close button is clicked', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />,
        {
          databases: [testDatabase],
          ui: { editorScreen: { databaseId: 'db-123', type: 'edit-database' } }
        }
      )

      await user.click(screen.getByRole('button', { name: '' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })
    })

    it('closes the editor screen when cancel is clicked', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          mode="edit"
        />,
        {
          databases: [testDatabase],
          ui: { editorScreen: { databaseId: 'db-123', type: 'edit-database' } }
        }
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })
    })
  })

  describe('create mode', () => {
    it('renders the add database header', () => {
      renderWithProviders(<EditorScreen mode="create" />, { databases: [] })

      expect(screen.getByText('Add database')).toBeInTheDocument()
    })

    it('starts with an empty form', () => {
      renderWithProviders(<EditorScreen mode="create" />, { databases: [] })

      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(screen.getByLabelText('Host')).toHaveValue('')
      expect(screen.getByLabelText('Username')).toHaveValue('')
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Database')).toHaveValue('')
    })
  })
})
