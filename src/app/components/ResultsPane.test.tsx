import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactElement, useState } from 'react'
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

// Switching tabs in the app changes which worksheet the pane is showing
// without unmounting it, so the harness does the same.
function SwitchablePane(): ReactElement {
  const [worksheetId, setWorksheetId] = useState('ws-1')

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setWorksheetId((current) => (current === 'ws-1' ? 'ws-2' : 'ws-1'))
        }
      >
        Switch worksheet
      </button>

      <ResultsPane
        databaseName="Pagila"
        isQueryRunning={false}
        query={undefined}
        worksheetId={worksheetId}
      />
    </>
  )
}

function paneHeight(): string | undefined {
  return screen.getByText('No results yet').closest('section')?.style.height
}

// Shift with an arrow is the large step: 40px, and the results handle grows
// upwards, so ArrowUp makes the pane taller.
async function resize(
  user: ReturnType<typeof userEvent.setup>,
  keys: string
): Promise<void> {
  await user.click(
    screen.getByRole('separator', { name: 'Resize results panel' })
  )
  await user.keyboard(keys)
}

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

  // The issue: one worksheet's results pane was every worksheet's.
  it('keeps a height of its own for each worksheet', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SwitchablePane />, {
      queries: [],
      tabs: { openWorksheetIds: ['ws-1', 'ws-2'] }
    })

    await resize(user, '{Shift>}{ArrowUp}{/Shift}')

    expect(paneHeight()).toEqual('360px')

    await user.click(screen.getByRole('button', { name: 'Switch worksheet' }))
    await resize(user, '{ArrowDown}{ArrowDown}')

    expect(paneHeight()).toEqual('340px')

    await user.click(screen.getByRole('button', { name: 'Switch worksheet' }))

    expect(paneHeight()).toEqual('360px')
  })

  // Nobody has resized this one yet, and snapping back to the app default
  // would read as the panel jumping every time a new tab is opened.
  it('starts a worksheet nobody has resized at the last height used', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SwitchablePane />, {
      queries: [],
      tabs: { openWorksheetIds: ['ws-1', 'ws-2'] }
    })

    await resize(user, '{Shift>}{ArrowUp}{/Shift}')
    await user.click(screen.getByRole('button', { name: 'Switch worksheet' }))

    expect(paneHeight()).toEqual('360px')
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
