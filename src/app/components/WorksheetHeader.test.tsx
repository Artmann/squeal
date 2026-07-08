import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders, type RenderOptions } from '../test-utils'
import { type Statement } from '../sql-parser'
import { WorksheetHeader } from './WorksheetHeader'

const statement: Statement = {
  end: 8,
  start: 0,
  text: 'SELECT 1',
  type: 'select'
}

const emptyData: RenderOptions = { databases: [], queries: [], worksheets: [] }

describe('WorksheetHeader', () => {
  it('enables the run button when a statement is active', () => {
    renderWithProviders(
      <WorksheetHeader
        activeStatement={statement}
        isQueryRunning={false}
        saveState="idle"
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('disables the run button while a query is running', () => {
    renderWithProviders(
      <WorksheetHeader
        activeStatement={statement}
        isQueryRunning
        saveState="idle"
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('shows the save indicator state', () => {
    renderWithProviders(
      <WorksheetHeader
        activeStatement={statement}
        isQueryRunning={false}
        saveState="saved"
        onRunQuery={vi.fn()}
      />,
      emptyData
    )

    expect(screen.getByText('Saved')).toBeInTheDocument()
  })
})
