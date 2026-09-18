import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialogProvider, useConfirm } from './ConfirmDialogProvider'

function Subject({ onConfirm }: { onConfirm: () => void }): ReactElement {
  const confirm = useConfirm()

  return (
    <button
      onClick={() =>
        confirm({
          confirmLabel: 'Delete',
          description: 'This cannot be undone.',
          onConfirm,
          title: 'Delete "Orders"?'
        })
      }
    >
      Ask
    </button>
  )
}

function renderSubject(onConfirm: () => void) {
  return render(
    <ConfirmDialogProvider>
      <Subject onConfirm={onConfirm} />
    </ConfirmDialogProvider>
  )
}

describe('ConfirmDialogProvider', () => {
  it('shows nothing until something asks', () => {
    renderSubject(vi.fn())

    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks with the title and description it was given', async () => {
    const user = userEvent.setup()

    renderSubject(vi.fn())

    await user.click(screen.getByRole('button', { name: 'Ask' }))

    const dialog = await screen.findByRole('alertdialog')

    expect(dialog).toHaveTextContent('Delete "Orders"?')
    expect(dialog).toHaveTextContent('This cannot be undone.')
  })

  it('runs the callback and closes when confirmed', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    renderSubject(onConfirm)

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
  })

  it('does not run the callback when cancelled', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    renderSubject(onConfirm)

    await user.click(screen.getByRole('button', { name: 'Ask' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not run the callback when dismissed with Escape', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()

    renderSubject(onConfirm)

    await user.click(screen.getByRole('button', { name: 'Ask' }))

    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('refuses to be used without a provider', () => {
    // React logs the thrown render error; the assertion is the throw itself.
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    expect(() => render(<Subject onConfirm={vi.fn()} />)).toThrow(
      /ConfirmDialogProvider/
    )

    consoleError.mockRestore()
  })
})
