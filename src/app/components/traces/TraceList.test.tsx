import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { describe, expect, it, vi } from 'vitest'

import type { TraceSummaryDto } from '@/glue/api/schemas'

import { TraceList } from './TraceList'

const traces: TraceSummaryDto[] = [
  {
    durationMs: 152.4,
    errorMessage: null,
    hasError: false,
    name: 'query.run',
    serviceName: 'renderer',
    spanCount: 6,
    startedAt: Date.now() - 60000,
    traceId: 'trace-1'
  },
  {
    durationMs: 12,
    errorMessage: 'Failed to load schema for "Guvnor (Dev)"',
    hasError: true,
    name: 'HTTP GET /worksheets',
    serviceName: 'renderer',
    spanCount: 2,
    startedAt: Date.now() - 120000,
    traceId: 'trace-2'
  }
]

describe('TraceList', () => {
  it('renders a row per trace', () => {
    render(
      <TraceList
        onSelect={vi.fn()}
        traces={traces}
      />
    )

    expect(screen.getByText('query.run')).toBeInTheDocument()
    expect(screen.getByText('HTTP GET /worksheets')).toBeInTheDocument()
    expect(screen.getByText('152ms')).toBeInTheDocument()
  })

  it('shows what went wrong for error traces', () => {
    render(
      <TraceList
        onSelect={vi.fn()}
        traces={traces}
      />
    )

    expect(
      screen.getByText('Failed to load schema for "Guvnor (Dev)"')
    ).toBeInTheDocument()
  })

  it('marks traces containing errors', () => {
    render(
      <TraceList
        onSelect={vi.fn()}
        traces={traces}
      />
    )

    expect(screen.getAllByLabelText('error').length).toEqual(1)
    expect(screen.getAllByLabelText('ok').length).toEqual(1)
  })

  it('shows the absolute time on hover', () => {
    render(
      <TraceList
        onSelect={vi.fn()}
        traces={traces}
      />
    )

    const firstTrace = traces[0]

    if (!firstTrace) {
      throw new Error('Test fixture is empty')
    }

    expect(
      screen.getByTitle(dayjs(firstTrace.startedAt).format('lll'))
    ).toBeInTheDocument()
  })

  it('selects a trace on click', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()

    render(
      <TraceList
        onSelect={onSelect}
        traces={traces}
      />
    )

    await user.click(screen.getByText('query.run'))

    expect(onSelect).toHaveBeenCalledWith('trace-1')
  })
})
