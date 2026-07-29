import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SpanDto, TraceSummaryDto } from '@/main/tracing/routes'

vi.mock('@/app/api-client', () => ({
  apiClient: {
    getTraceSpans: vi.fn(),
    getTraces: vi.fn()
  }
}))

import { apiClient } from '@/app/api-client'
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

  return { store }
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
      expect(screen.queryByText('Attributes')).not.toBeInTheDocument()
    })
    expect(screen.getByText('db.query')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(await screen.findByText('Spans')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(store.getState().ui.traceDashboardOpen).toEqual(false)
    })
  })
})
