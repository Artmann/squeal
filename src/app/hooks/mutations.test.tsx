import { act, fireEvent, renderHook, screen } from '@testing-library/react'
import { ReactElement } from 'react'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canceledQueryMessage } from '@/glue/queries'
import type { QueryDto } from '@/glue/api/schemas'

import { renderWithProviders } from '../test-utils'
import { useCancelQuery } from './mutations'
import { useQueriesList, useQueryResultSync } from './queries'

vi.mock('../api-client', () => ({
  apiClient: {
    cancelQuery: vi.fn(async () => undefined),
    getDatabases: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getQuery: vi.fn(),
    getWorksheets: vi.fn(async () => [])
  }
}))

import { apiClient } from '../api-client'

const runningQuery: QueryDto = {
  content: 'SELECT pg_sleep(30);',
  databaseId: 'database-1',
  error: null,
  finishedAt: null,
  id: 'q-1',
  queriedAt: 1,
  result: null,
  worksheetId: 'ws-1'
}

const canceledQuery: QueryDto = {
  ...runningQuery,
  error: canceledQueryMessage,
  finishedAt: 2
}

// The same pairing `App` makes: the poller is the only writer of the terminal
// row, and cancel is a request that the poller is expected to observe.
function CancelProbe(): ReactElement {
  const queries = useQueriesList()
  const query = queries.data[0]

  useQueryResultSync(query)

  const { cancel, isCanceling } = useCancelQuery(query)

  return (
    <>
      <button
        onClick={cancel}
        type="button"
      >
        cancel
      </button>

      <output>{isCanceling ? 'canceling' : 'idle'}</output>
      <output>{query?.finishedAt ? 'finished' : 'running'}</output>
      <output>{query?.error ?? 'no error'}</output>
    </>
  )
}

// A backend that finalizes the row only once someone asks it to, which is what
// makes the window between the click and the terminal row observable.
function finalizeOnCancel(): void {
  let finalized = false

  vi.mocked(apiClient.getQuery).mockImplementation(async () =>
    finalized ? canceledQuery : runningQuery
  )

  vi.mocked(apiClient.cancelQuery).mockImplementation(async () => {
    finalized = true
  })
}

function stayRunning(): void {
  vi.mocked(apiClient.getQuery).mockImplementation(async () => runningQuery)
  vi.mocked(apiClient.cancelQuery).mockImplementation(async () => undefined)
}

// A backend that refuses the cancel outright, with the row left running — what
// the user sees when the request never lands.
function failCancel(): void {
  vi.mocked(apiClient.getQuery).mockImplementation(async () => runningQuery)
  vi.mocked(apiClient.cancelQuery).mockRejectedValue(
    new Error('The connection was lost.')
  )
}

/**
 * A backend whose cancel answers only when the test says so, and whose row can
 * be finalized separately. That is the only way to put a whole query lifetime
 * between the click and the answer to it.
 */
function deferredCancels() {
  const rejecters = new Map<string, (error: Error) => void>()

  let row = runningQuery

  vi.mocked(apiClient.getQuery).mockImplementation(async () => row)
  vi.mocked(apiClient.cancelQuery).mockImplementation(
    (queryId: string) =>
      new Promise<void>((_resolve, reject) => {
        rejecters.set(queryId, reject)
      })
  )

  return {
    async fail(queryId: string): Promise<void> {
      const reject = rejecters.get(queryId)

      invariant(reject, `No cancel is in flight for ${queryId}.`)

      await act(async () => {
        reject(new Error('The connection was lost.'))
      })
    },
    finalize(): void {
      row = canceledQuery
    }
  }
}

describe('useCancelQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks the backend to cancel the running query', () => {
    stayRunning()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(vi.mocked(apiClient.cancelQuery).mock.calls).toEqual([['q-1']])
  })

  // The row is the backend's to finalize. Writing a terminal state here would
  // disable the poller in the very window it is needed, which is why the old
  // implementation had to hand-roll a second one.
  it('leaves the row running until the backend finalizes it', async () => {
    stayRunning()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('canceling')).toBeInTheDocument()

    expect({
      error: screen.getByText('no error').textContent,
      row: screen.getByText('running').textContent
    }).toEqual({ error: 'no error', row: 'running' })
  })

  it('shows the query as canceled once the backend finalizes it', async () => {
    finalizeOnCancel()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('finished')).toBeInTheDocument()

    expect(screen.getByText(canceledQueryMessage)).toBeInTheDocument()
  })

  // Self-clears off the row rather than off the request, so the flag cannot
  // outlive the query it belongs to.
  it('stops reporting canceling once the terminal row arrives', async () => {
    finalizeOnCancel()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('finished')).toBeInTheDocument()

    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  // The button used to unmount on click, so nothing had to stop a second one.
  // Now it stays on screen for as long as the query runs.
  it('ignores a second click while the first cancel is in flight', async () => {
    stayRunning()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('canceling')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(vi.mocked(apiClient.cancelQuery).mock.calls).toEqual([['q-1']])
  })

  // The flag belongs to the query it was set for, not to whatever is running
  // now. Running a second query while the first is still being canceled would
  // otherwise open with its cancel button already spent.
  it('does not report canceling for a query it was not asked about', () => {
    stayRunning()

    const { rerender, result } = renderHook(
      ({ query }: { query: QueryDto }) => useCancelQuery(query),
      { initialProps: { query: runningQuery } }
    )

    act(() => {
      result.current.cancel()
    })

    expect(result.current.isCanceling).toEqual(true)

    rerender({ query: { ...runningQuery, id: 'q-2' } })

    expect(result.current.isCanceling).toEqual(false)

    act(() => {
      result.current.cancel()
    })

    expect(vi.mocked(apiClient.cancelQuery).mock.calls).toEqual([
      ['q-1'],
      ['q-2']
    ])
  })

  // A cancel that never reached the backend is not a cancel. Leaving the label
  // on "Canceling…" forever would tell the user the query is on its way out
  // when nothing has asked for it.
  it('offers cancel again when the request fails', async () => {
    failCancel()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('idle')).toBeInTheDocument()

    expect(screen.getByText('running')).toBeInTheDocument()
  })

  // The query keeps running either way, so the one thing the user must not be
  // left with is a click that looks like it worked.
  it('says so when the cancel request fails', async () => {
    failCancel()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(
      await screen.findByText('Could not cancel the query')
    ).toBeInTheDocument()

    expect(
      screen.getByText('The query is still running. The connection was lost.')
    ).toBeInTheDocument()
  })

  // A cancel request can outlive the query it belongs to: the backend bounds
  // its cancel work at five seconds and the poller can write the terminal row
  // first. A rejection that lands after that describes a query nobody is
  // looking at any more, and saying so would be a message about nothing.
  it('says nothing when the cancel fails after the query has finished', async () => {
    const cancels = deferredCancels()

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(await screen.findByText('canceling')).toBeInTheDocument()

    cancels.finalize()

    expect(await screen.findByText('finished')).toBeInTheDocument()

    await cancels.fail('q-1')

    // Absence needs a wait: the toast the other cases assert on is only found
    // by polling, so checking immediately would pass without proving anything.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(screen.queryByText('Could not cancel the query')).toBeNull()
  })

  // The same rejection must not re-enable a Cancel that belongs to a different
  // query — that one's own request is still in flight.
  it('leaves a later query alone when an earlier cancel fails', async () => {
    const cancels = deferredCancels()

    const { rerender, result } = renderHook(
      ({ query }: { query: QueryDto }) => useCancelQuery(query),
      { initialProps: { query: runningQuery } }
    )

    act(() => {
      result.current.cancel()
    })

    rerender({ query: { ...runningQuery, id: 'q-2' } })

    act(() => {
      result.current.cancel()
    })

    await cancels.fail('q-1')

    expect(result.current.isCanceling).toEqual(true)
  })

  // A finished row can go back to running: a slow insert response landing after
  // the poller already saw the query finish rewrites it. The button must not
  // come back saying "Canceling…" with nothing in flight.
  it('forgets the cancel once the query it belongs to has finished', () => {
    stayRunning()

    const { rerender, result } = renderHook(
      ({ query }: { query: QueryDto }) => useCancelQuery(query),
      { initialProps: { query: runningQuery } }
    )

    act(() => {
      result.current.cancel()
    })

    rerender({ query: canceledQuery })
    rerender({ query: runningQuery })

    expect(result.current.isCanceling).toEqual(false)
  })

  // Only the canceled query's own terminal row means the cancel is over. Every
  // worksheet has its own latest query, so looking at a finished one elsewhere
  // must leave the cancel you started intact for when you come back to it.
  it('keeps the cancel while a different query is finished', () => {
    stayRunning()

    const { rerender, result } = renderHook(
      ({ query }: { query: QueryDto }) => useCancelQuery(query),
      { initialProps: { query: runningQuery } }
    )

    act(() => {
      result.current.cancel()
    })

    rerender({ query: { ...canceledQuery, id: 'q-2' } })
    rerender({ query: runningQuery })

    expect(result.current.isCanceling).toEqual(true)
  })

  // A rejection that is not an `Error` has no message worth showing, so the
  // advice has to come from us — an empty half would read as a cut-off
  // sentence.
  it('still says what to do when the failure carries no message', async () => {
    vi.mocked(apiClient.getQuery).mockImplementation(async () => runningQuery)
    vi.mocked(apiClient.cancelQuery).mockRejectedValue('no message at all')

    renderWithProviders(<CancelProbe />, { queries: [runningQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(
      await screen.findByText(
        'The query is still running. Try canceling it again.'
      )
    ).toBeInTheDocument()
  })

  it('does nothing for a query that has already finished', () => {
    stayRunning()

    renderWithProviders(<CancelProbe />, { queries: [canceledQuery] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect({
      calls: vi.mocked(apiClient.cancelQuery).mock.calls,
      canceling: screen.getByText('idle').textContent
    }).toEqual({ calls: [], canceling: 'idle' })
  })

  it('does nothing when there is no query to cancel', () => {
    stayRunning()

    renderWithProviders(<CancelProbe />, { queries: [] })

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))

    expect(vi.mocked(apiClient.cancelQuery).mock.calls).toEqual([])
  })
})
