import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, type RenderOptions } from '../test-utils'
import { type Statement } from '../sql-parser'
import { WorksheetToolbar } from './WorksheetToolbar'

// Radix's tooltip positioning needs DOM APIs jsdom does not ship.
beforeAll(() => {
  window.ResizeObserver = class ResizeObserver {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  } as unknown as typeof window.ResizeObserver
})

const statement: Statement = {
  end: 8,
  start: 0,
  text: 'SELECT 1',
  type: 'select'
}

const emptyData: RenderOptions = { databases: [], queries: [], worksheets: [] }

function setPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform
  })
}

const originalPlatform = window.navigator.platform

describe('WorksheetToolbar', () => {
  afterEach(() => {
    setPlatform(originalPlatform)
  })

  it('runs the active statement when the run button is clicked', async () => {
    const user = userEvent.setup()
    const onRunQuery = vi.fn()

    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={onRunQuery}
      />,
      emptyData
    )

    const runButton = screen.getByRole('button', { name: /Run/ })

    expect(runButton).toBeEnabled()

    await user.click(runButton)

    expect(onRunQuery).toHaveBeenCalledTimes(1)
  })

  it('shows the macOS shortcut badge on macOS', () => {
    setPlatform('MacIntel')

    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByText('⌘↵')).toBeInTheDocument()
  })

  it('shows the control shortcut badge off macOS', () => {
    setPlatform('Win32')

    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByText('Ctrl↵')).toBeInTheDocument()
  })

  it('disables run and explains why when no statement is active', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <WorksheetToolbar
        activeStatement={null}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled()

    await user.hover(screen.getByText('Run'))

    expect(
      await screen.findAllByText('Place your cursor in a statement to run it.')
    ).not.toHaveLength(0)
  })

  it('hides cancel while no query is running', () => {
    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
  })

  it('offers cancel while a query is running', async () => {
    const user = userEvent.setup()
    const onCancelQuery = vi.fn()

    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning
        onCancelQuery={onCancelQuery}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByRole('button', { name: /Run/ })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancelQuery).toHaveBeenCalledTimes(1)
  })

  it('disables cancel while the cancel request is pending', () => {
    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending
        isQueryRunning
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByRole('button', { name: 'Canceling…' })).toBeDisabled()
  })

  it('renders no save indicator', () => {
    renderWithProviders(
      <WorksheetToolbar
        activeStatement={statement}
        isCancelPending={false}
        isQueryRunning={false}
        onCancelQuery={vi.fn()}
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
  })
})
