import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpanDto, TraceSummaryDto } from '@/glue/api/schemas'

vi.mock('@/app/api-client', () => ({
  apiClient: {
    getTraceSpans: vi.fn(),
    getTraces: vi.fn()
  }
}))

import { apiClient } from '@/app/api-client'
import { queryKeys } from '@/app/query-keys'
import { createStore } from '@/app/store'
import { uiActions } from '@/app/store/ui-slice'

import { TraceDashboard } from './TraceDashboard'

const mockedApiClient = vi.mocked(apiClient)

const traceFixture: TraceSummaryDto = {
  durationMs: 100,
  errorMessage: null,
  hasError: false,
  name: 'query.run',
  serviceName: 'renderer',
  spanCount: 2,
  startedAt: Date.now(),
  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
}

function buildSpan(overrides: Partial<SpanDto>): SpanDto {
  return {
    attributes: {},
    durationMs: 10,
    events: [],
    id: 'span-id',
    kind: 'internal',
    name: 'span',
    parentSpanId: null,
    serviceName: 'main',
    startedAt: 1000,
    status: 'ok',
    statusMessage: null,
    traceId: traceFixture.traceId,
    ...overrides
  }
}

const spanFixtures = [
  buildSpan({
    durationMs: 100,
    id: 'root',
    name: 'query.run',
    startedAt: 1000
  }),
  buildSpan({
    attributes: { 'db.system': 'postgres' },
    id: 'child',
    name: 'db.query',
    parentSpanId: 'root',
    startedAt: 1010
  })
]

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  const store = createStore()

  store.dispatch(uiActions.toggleTraceDashboard())

  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <TraceDashboard />
      </Provider>
    </QueryClientProvider>
  )

  return { queryClient, store }
}

describe('TraceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a spinner while traces load', () => {
    mockedApiClient.getTraces.mockReturnValue(
      new Promise(() => {
        // Never resolves — keeps the query pending.
      })
    )

    renderDashboard()

    expect(screen.getByLabelText('Loading traces')).toBeInTheDocument()
  })

  it('shows an error state and recovers on retry', async () => {
    mockedApiClient.getTraces
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue([])

    renderDashboard()

    const user = userEvent.setup()
    const retry = await screen.findByRole('button', { name: 'Retry' })

    await user.click(retry)

    expect(await screen.findByText(/No traces yet/)).toBeInTheDocument()
  })

  it('tells apart an empty history and empty filter results', async () => {
    mockedApiClient.getTraces.mockResolvedValue([])

    renderDashboard()

    const user = userEvent.setup()

    expect(await screen.findByText(/No traces yet/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Errors only' }))

    expect(
      await screen.findByText('No traces match your filters.')
    ).toBeInTheDocument()
  })

  it('steps back progressively with escape', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    const { store } = renderDashboard()
    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    })
    expect(screen.getByText('db.query')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(await screen.findByText('Spans')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(store.getState().ui.traceDashboardOpen).toEqual(false)
    })
  })

  // TanStack Query keeps the last successful `data` when a background refetch
  // fails, and the dashboard polls every two seconds. The sidebar was rendered
  // from that kept data while the waterfall beside it had already been replaced
  // by an error, so one failed poll put a stale span next to "Could not load
  // this trace."
  it('takes the span sidebar down with the waterfall when a poll fails', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    const { queryClient } = renderDashboard()
    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    mockedApiClient.getTraceSpans.mockRejectedValue(new Error('server down'))

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.traceSpans(traceFixture.traceId)
      })
    })

    await waitFor(() => {
      expect({
        error: screen.queryByText('Could not load this trace.')?.textContent,
        sidebar: screen.queryByRole('complementary')
      }).toEqual({ error: 'Could not load this trace.', sidebar: null })
    })

    // The selection went with the sidebar, so escape has one rung left rather
    // than a silent one to spend first.
    await user.keyboard('{Escape}')

    expect(await screen.findByText('Spans')).toBeInTheDocument()
  })

  // Retention trims spans out from under an open sidebar. The selection then
  // named a span nobody could see, and the escape ladder still stepped through
  // it, so the first press did nothing the user could observe.
  it('gives up a selected span that a later poll no longer returns', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    const { queryClient } = renderDashboard()
    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    mockedApiClient.getTraceSpans.mockResolvedValue([
      buildSpan({ durationMs: 100, id: 'root', name: 'query.run' })
    ])

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.traceSpans(traceFixture.traceId)
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    })

    await user.keyboard('{Escape}')

    expect(await screen.findByText('Spans')).toBeInTheDocument()
  })

  // The split render this component was rearranged around only happens because
  // the spans reload behind the open trace, so the interval is part of the fix
  // rather than a detail of it.
  it('reloads the spans of the open trace on a timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      mockedApiClient.getTraces.mockResolvedValue([traceFixture])
      mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

      renderDashboard()

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

      await user.click(await screen.findByText('query.run'))

      expect(await screen.findByText('db.query')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      expect(mockedApiClient.getTraceSpans.mock.calls).toEqual([
        [traceFixture.traceId],
        [traceFixture.traceId]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // The waterfall decides what a click means by comparing the row against the
  // selection it was given, so a panel that keeps the selection to itself turns
  // clicking the open span into a no-op instead of a close.
  it('closes the sidebar when the open span is clicked again', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    renderDashboard()

    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    // By title, not by text: the sidebar shows the span name too.
    await user.click(screen.getByTitle('db.query'))

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    })
  })

  // Opening a trace opens the waterfall and nothing else, and the header trades
  // the filters for the trace it is showing.
  it('names the open trace in the header without opening a span', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    renderDashboard()

    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))

    expect(await screen.findByText('db.query')).toBeInTheDocument()

    const header = within(screen.getByRole('banner'))

    expect({
      duration: header.getByText('100ms').textContent,
      heading: header.getByRole('heading').textContent,
      sidebar: screen.queryByRole('complementary'),
      traceId: header.getByTitle('Copy trace ID').textContent
    }).toEqual({
      duration: '100ms',
      heading: 'query.run',
      sidebar: null,
      traceId: 'aaaaaaaaaaaaaaaa…'
    })
  })

  // The other direction of the same effect, and the one with no visible
  // symptom to notice: the sidebar polls every two seconds behind the user, and
  // a reconciliation that fired on a successful poll would close it under them.
  it('keeps the open span through a poll that returns it again', async () => {
    mockedApiClient.getTraces.mockResolvedValue([traceFixture])
    mockedApiClient.getTraceSpans.mockResolvedValue(spanFixtures)

    const { queryClient } = renderDashboard()
    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: queryKeys.traceSpans(traceFixture.traceId)
      })
    })

    expect(screen.getByRole('complementary')).toBeInTheDocument()

    // Still three rungs: the span is open, so the first press closes it rather
    // than leaving the waterfall.
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    })

    expect(screen.getByText('db.query')).toBeInTheDocument()
  })

  // The span belongs to the trace, not to the dashboard: leaving one trace and
  // opening another must not reopen a sidebar for a span the second trace has
  // never heard of.
  it('opens a second trace with no sidebar from the first', async () => {
    const secondTrace = {
      ...traceFixture,
      name: 'query.cancel',
      traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    }

    mockedApiClient.getTraces.mockResolvedValue([traceFixture, secondTrace])
    mockedApiClient.getTraceSpans.mockImplementation(async (traceId) =>
      traceId === traceFixture.traceId
        ? spanFixtures
        : [
            buildSpan({
              id: 'child',
              name: 'db.cancel',
              traceId: secondTrace.traceId
            })
          ]
    )

    renderDashboard()

    const user = userEvent.setup()

    await user.click(await screen.findByText('query.run'))
    await user.click(await screen.findByText('db.query'))

    expect(await screen.findByText('Attributes')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')

    await user.click(await screen.findByText('query.cancel'))

    expect(await screen.findByText('db.cancel')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})
