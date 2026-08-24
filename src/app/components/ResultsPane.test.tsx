import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactElement, useState } from 'react'
import invariant from 'tiny-invariant'
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
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(screen.queryByText(/rows ·/)).not.toBeInTheDocument()
  })

  // The meta line and the body have to answer "is this still running" from the
  // same place. While that answer arrived as a prop, a caller could make them
  // disagree -- a spinner under a header reading "100 rows", or the reverse.
  it('shows the running body and no meta line for a query still in flight', () => {
    const runningQuery = query({ ...successfulQuery, finishedAt: null })

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        query={runningQuery}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [runningQuery] }
    )

    expect(screen.getByText('Running on Pagila…')).toBeInTheDocument()
    expect(screen.queryByText(/rows ·/)).not.toBeInTheDocument()
    expect(screen.queryByText('No results yet')).not.toBeInTheDocument()
  })

  it('summarises a successful run', () => {
    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
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

const findableResult = {
  fields: [{ name: 'title' }],
  rowCount: 3,
  rows: [
    { title: 'Alien' },
    { title: 'Alien Nation' },
    { title: 'Barbarella' }
  ],
  truncated: false
}

const findableQuery = query({ result: findableResult })

// The same switch as `SwitchablePane`, but with a result behind each worksheet
// so there is something for find to open onto.
function SwitchableResultPane(): ReactElement {
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
        query={{ ...findableQuery, worksheetId }}
        worksheetId={worksheetId}
      />
    </>
  )
}

function renderFindablePane(
  options: Parameters<typeof renderWithProviders>[1] = {}
) {
  return renderWithProviders(
    <ResultsPane
      databaseName="Pagila"
      query={findableQuery}
      worksheetId="ws-1"
    />,
    { openWorksheetId: 'ws-1', queries: [], ...options }
  )
}

function findInput(): HTMLInputElement {
  const input = screen.getByPlaceholderText('Find in results')

  invariant(input instanceof HTMLInputElement, 'The find box is an input.')

  return input
}

describe('ResultsPane find in results', () => {
  // The whole point of the shortcut: the box has to be ready for the paste that
  // follows it, wherever focus happened to be. The editor holds focus by
  // default, so this is the case that matters.
  it('opens the find bar on the shortcut and gives it focus', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')

    expect(findInput()).toHaveFocus()
  })

  it('selects what is already in the box when the shortcut is pressed again', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')

    expect(findInput().selectionStart).toEqual(5)

    await user.keyboard('{Meta>}f{/Meta}')

    // Selected rather than appended to, so the next paste replaces the old id.
    expect(findInput().selectionStart).toEqual(0)
    expect(findInput().selectionEnd).toEqual(5)
  })

  it('counts the rows that matched', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')

    expect(screen.getByRole('status')).toHaveTextContent('1 of 2')
  })

  it('steps through the matches with Enter, wrapping at the end', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')
    await user.keyboard('{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('2 of 2')

    await user.keyboard('{Enter}')

    expect(screen.getByRole('status')).toHaveTextContent('1 of 2')
  })

  it('steps backwards with Shift and Enter, wrapping at the start', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(screen.getByRole('status')).toHaveTextContent('2 of 2')
  })

  it('goes back to the first match when the query changes', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')
    await user.keyboard('{Enter}')
    await user.type(findInput(), ' n')

    expect(screen.getByRole('status')).toHaveTextContent('1 of 1')
  })

  it('says so when nothing matched', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'nobody')

    expect(screen.getByRole('status')).toHaveTextContent('No matches')
  })

  // A row missing from the first page is not a row missing from the table, and
  // a bare "No matches" against a capped result answers the wrong question.
  it('says how far the search reached when the result was cut off', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        query={query({ result: { ...findableResult, truncated: true } })}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'nobody')

    expect(screen.getByRole('status')).toHaveTextContent(
      'No matches in the first 10,000 rows'
    )
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.keyboard('{Escape}')

    expect(
      screen.queryByPlaceholderText('Find in results')
    ).not.toBeInTheDocument()
  })

  // Clicking any control in the bar moves focus off the input, and Escape used
  // to be the input's own handler -- so the key went dead exactly after the
  // user had reached for the filter.
  it('still closes on Escape after a bar button took focus', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')
    await user.click(
      screen.getByRole('button', { name: 'Hide non-matching rows' })
    )

    expect(
      screen.getByRole('button', { name: 'Hide non-matching rows' })
    ).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(
      screen.queryByPlaceholderText('Find in results')
    ).not.toBeInTheDocument()
  })

  it('hides the non-matching rows once the filter is turned on', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')

    expect(screen.getAllByRole('row')).toHaveLength(4)

    await user.click(
      screen.getByRole('button', { name: 'Hide non-matching rows' })
    )

    // The header plus the two matches; Barbarella is gone.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('offers nothing to find until there is a result', () => {
    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        query={undefined}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    expect(
      screen.queryByRole('button', { name: 'Find in results' })
    ).not.toBeInTheDocument()
  })

  it('opens onto an empty result and says there is nothing to search', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ResultsPane
        databaseName="Pagila"
        query={query({
          result: { fields: [], rowCount: 0, rows: [], truncated: false }
        })}
        worksheetId="ws-1"
      />,
      { openWorksheetId: 'ws-1', queries: [] }
    )

    await user.keyboard('{Meta>}f{/Meta}')

    expect(screen.getByRole('status')).toHaveTextContent('No rows to search')
  })

  it('brings the results back when the shortcut is used on the Messages tab', async () => {
    const user = userEvent.setup()
    renderFindablePane()

    await user.click(screen.getByRole('tab', { name: 'Messages' }))

    expect(screen.getByRole('tab', { name: 'Messages' })).toHaveAttribute(
      'aria-selected',
      'true'
    )

    await user.keyboard('{Meta>}f{/Meta}')

    expect(screen.getByRole('tab', { name: 'Results' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(findInput()).toHaveFocus()
  })

  // `EditorScreen` covers a still-mounted workspace, so a find bar opening
  // behind it would take focus out of a form the user is filling in.
  it('leaves the shortcut alone while an overlay is up', async () => {
    const user = userEvent.setup()
    renderFindablePane({ ui: { editorScreen: { type: 'create-database' } } })

    await user.keyboard('{Meta>}f{/Meta}')

    expect(
      screen.queryByPlaceholderText('Find in results')
    ).not.toBeInTheDocument()
  })

  it('keeps a find query of its own for each worksheet', async () => {
    const user = userEvent.setup()

    renderWithProviders(<SwitchableResultPane />, {
      queries: [],
      tabs: { openWorksheetIds: ['ws-1', 'ws-2'] }
    })

    await user.keyboard('{Meta>}f{/Meta}')
    await user.type(findInput(), 'alien')
    await user.click(screen.getByRole('button', { name: 'Switch worksheet' }))

    // The other worksheet never had a find open, so it does not inherit one.
    expect(
      screen.queryByPlaceholderText('Find in results')
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Switch worksheet' }))

    expect(findInput()).toHaveValue('alien')
  })
})
