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
          type="edit-database"
        />,
        { databases: [testDatabase] }
      )

      expect(screen.getByText('Edit database')).toBeInTheDocument()
    })

    it('pre-populates the form with the database values', () => {
      renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          type="edit-database"
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
          type="edit-database"
        />,
        { databases: [] }
      )

      expect(
        screen.getByText(
          'This database has been deleted. Close this screen and pick another one.'
        )
      ).toBeInTheDocument()

      // The message replaces the form rather than joining it. A form left
      // mounted here is in edit mode against a row that is gone, so Save
      // would PATCH a deleted id.
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()

      // The panel keeps its header, which is what carries the close button.
      expect(screen.getByText('Edit database')).toBeInTheDocument()
    })

    it('can be closed when the database is not found', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen
          databaseId="nonexistent"
          type="edit-database"
        />,
        {
          databases: [],
          ui: {
            editorScreen: { databaseId: 'nonexistent', type: 'edit-database' }
          }
        }
      )

      // The screen is a full-screen overlay over everything else, so a panel
      // with no way out is not a message -- it is a stuck window.
      await user.click(screen.getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })
    })

    it('closes the editor screen when the close button is clicked', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          type="edit-database"
        />,
        {
          databases: [testDatabase],
          ui: { editorScreen: { databaseId: 'db-123', type: 'edit-database' } }
        }
      )

      await user.click(screen.getByRole('button', { name: 'Close' }))

      await waitFor(() => {
        expect(store.getState().ui.editorScreen).toBeUndefined()
      })
    })

    it('closes the editor screen when cancel is clicked', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          type="edit-database"
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
      renderWithProviders(<EditorScreen type="create-database" />, {
        databases: []
      })

      expect(screen.getByText('Add database')).toBeInTheDocument()
    })

    it('starts with an empty form', () => {
      renderWithProviders(<EditorScreen type="create-database" />, {
        databases: []
      })

      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(screen.getByLabelText('Host')).toHaveValue('')
      expect(screen.getByLabelText('Username')).toHaveValue('')
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Database')).toHaveValue('')
    })
  })
})
