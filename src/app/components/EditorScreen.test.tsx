import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactElement } from 'react'
import invariant from 'tiny-invariant'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { useAppDispatch, useAppSelector } from '../store'
import { uiActions } from '../store/ui-slice'
import { makeDatabase } from '../test-fixtures'
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

const testDatabase = makeDatabase()

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

  describe('dialog semantics', () => {
    it('is a modal dialog named by its title', () => {
      renderWithProviders(
        <EditorScreen
          databaseId="db-123"
          type="edit-database"
        />,
        { databases: [testDatabase] }
      )

      const dialog = screen.getByRole('dialog', { name: 'Edit database' })

      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen type="create-database" />,
        {
          databases: [],
          ui: { editorScreen: { type: 'create-database' } }
        }
      )

      await user.keyboard('{Escape}')

      expect(store.getState().ui.editorScreen).toBeUndefined()
    })

    it('closes on a click on the backdrop', async () => {
      const user = userEvent.setup()
      const { store } = renderWithProviders(
        <EditorScreen type="create-database" />,
        {
          databases: [],
          ui: { editorScreen: { type: 'create-database' } }
        }
      )

      const overlay = document.querySelector('[data-slot="dialog-overlay"]')

      invariant(overlay instanceof HTMLElement, 'The overlay is not rendered.')

      await user.click(overlay)

      expect(store.getState().ui.editorScreen).toBeUndefined()
    })

    it('stays open when something outside the backdrop is pressed', async () => {
      // Stands in for the title bar: outside the dialog and outside its
      // backdrop, and its window buttons must not discard the form.
      const { store } = renderWithProviders(
        <>
          <button type="button">Minimize</button>

          <EditorScreen type="create-database" />
        </>,
        {
          databases: [],
          ui: { editorScreen: { type: 'create-database' } }
        }
      )

      // `fireEvent` rather than `user.click`: the modal turns pointer events
      // off on `<body>`, which user-event honours, and the title bar opts
      // back in with a class jsdom has no stylesheet for. The waits are
      // Radix's: it starts listening for outside presses a tick after it
      // mounts, and it dismisses on the click that follows a press rather than
      // on the press itself.
      // By text, because the modal hides everything outside itself from the
      // accessibility tree.
      const minimize = screen.getByText('Minimize')

      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

      fireEvent.pointerDown(minimize)
      fireEvent.pointerUp(minimize)
      fireEvent.click(minimize)

      await act(() => new Promise((resolve) => setTimeout(resolve, 0)))

      expect(store.getState().ui.editorScreen).toEqual({
        type: 'create-database'
      })
    })

    it('returns focus to what had it before it opened', async () => {
      const user = userEvent.setup()

      // How App mounts it: only while the store has an editor screen.
      function Harness(): ReactElement {
        const dispatch = useAppDispatch()
        const editorScreen = useAppSelector((state) => state.ui.editorScreen)

        return (
          <>
            <button
              type="button"
              onClick={() => dispatch(uiActions.openCreateDatabase())}
            >
              Add database
            </button>

            {editorScreen && <EditorScreen {...editorScreen} />}
          </>
        )
      }

      renderWithProviders(<Harness />, { databases: [] })

      await user.click(screen.getByRole('button', { name: 'Add database' }))

      const dialog = await screen.findByRole('dialog', { name: 'Add database' })

      expect(dialog.contains(document.activeElement)).toEqual(true)

      await user.keyboard('{Escape}')

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Add database' })
        ).toHaveFocus()
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
