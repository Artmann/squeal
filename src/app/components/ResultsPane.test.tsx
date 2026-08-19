import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueryDto } from '@/glue/api/schemas'

import { stubElementSize } from '../test-element-size'
import { renderWithProviders } from '../test-utils'
import { ResultsPane } from './ResultsPane'

function query(overrides: Partial<QueryDto> = {}): QueryDto {
  return {
    content: 'SELECT * FROM film',
    databaseId: 'db-1',
    error: null,
    finishedAt: 3373,
    id: 'q-1',
    queriedAt: 1000,
    result: null,
    worksheetId: 'ws-1',
    ...overrides
  }
}

const successfulQuery = query({
  result: {
    fields: [{ name: 'title' }],
    rowCount: 100,
    rows: [{ title: 'Alien' }],
    truncated: false
  }
})

beforeEach(() => {
  localStorage.clear()
  Element.prototype.scrollTo = vi.fn()
  stubElementSize()
})

describe('ResultsPane', () => {
  it('is rendered before anything has run, showing the idle state', () => {
    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(screen.getByRole('tab', { name: 'Results' })).toBeInTheDocument()
    expect(screen.getByText('No results yet')).toBeInTheDocument()
  })

  it('shows no meta line while idle', () => {
    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(screen.queryByText(/rows ·/)).not.toBeInTheDocument()
  })

  it('summarises a successful run', () => {
    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={successfulQuery}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [successfulQuery] }
    )

    expect(screen.getByText(/100 rows/)).toBeInTheDocument()
    expect(screen.getByText(/2,373 ms/)).toBeInTheDocument()
  })

  it('summarises a failed run', () => {
    const failed = query({ error: 'boom', finishedAt: 1143 })

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={failed}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [failed] }
    )

    expect(screen.getByText(/failed · 143 ms/)).toBeInTheDocument()
  })

  it('switches to the message log', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={successfulQuery}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [successfulQuery] }
    )

    await user.click(screen.getByRole('tab', { name: 'Messages' }))

    expect(screen.getByText('SELECT * FROM film')).toBeInTheDocument()
    expect(screen.getByText('100 rows in 2,373 ms')).toBeInTheDocument()
  })

  it('tells the user when there are no messages', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    await user.click(screen.getByRole('tab', { name: 'Messages' }))

    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })

  it('restores the persisted height', () => {
    localStorage.setItem('ui:resultsHeight', '480')

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(
      screen.getByRole('separator', { name: 'Resize results panel' })
    ).toBeInTheDocument()
    expect(screen.getByText('No results yet').closest('section')).toHaveStyle({
      height: '480px'
    })
  })

  it('falls back to the default height for an out-of-range stored value', () => {
    localStorage.setItem('ui:resultsHeight', '9000')

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(screen.getByText('No results yet').closest('section')).toHaveStyle({
      height: '320px'
    })
  })
})
