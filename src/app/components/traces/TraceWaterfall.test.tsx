import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SpanDto } from '@/glue/api/schemas'

import { TraceWaterfall } from './TraceWaterfall'

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
    traceId: 'trace-id',
    ...overrides
  }
}

const spans = [
  buildSpan({
    durationMs: 100,
    id: 'root',
    name: 'query.run',
    startedAt: 1000
  }),
  buildSpan({
    id: 'child',
    name: 'db.query',
    parentSpanId: 'root',
    startedAt: 1010
  })
]

describe('TraceWaterfall', () => {
  it('renders a row per span', () => {
    render(
      <TraceWaterfall
        onSelectSpan={vi.fn()}
        spans={spans}
      />
    )

    expect(screen.getByText('query.run')).toBeInTheDocument()
    expect(screen.getByText('db.query')).toBeInTheDocument()
  })

  it('selects a span on click', async () => {
    const onSelectSpan = vi.fn()
    const user = userEvent.setup()

    render(
      <TraceWaterfall
        onSelectSpan={onSelectSpan}
        spans={spans}
      />
    )

    await user.click(screen.getByText('db.query'))

    expect(onSelectSpan).toHaveBeenCalledWith('child')
  })

  it('deselects the selected span on a second click', async () => {
    const onSelectSpan = vi.fn()
    const user = userEvent.setup()

    render(
      <TraceWaterfall
        onSelectSpan={onSelectSpan}
        selectedSpanId="child"
        spans={spans}
      />
    )

    await user.click(screen.getByText('db.query'))

    expect(onSelectSpan).toHaveBeenCalledWith(undefined)
  })

  it('renders a time ruler spanning the trace duration', () => {
    render(
      <TraceWaterfall
        onSelectSpan={vi.fn()}
        spans={spans}
      />
    )

    expect(screen.getByText('0ms')).toBeInTheDocument()
    expect(screen.getByText('50ms')).toBeInTheDocument()
  })

  it('exposes full span names as tooltips', () => {
    render(
      <TraceWaterfall
        onSelectSpan={vi.fn()}
        spans={spans}
      />
    )

    expect(screen.getByTitle('db.query')).toBeInTheDocument()
  })

  it('collapses subtrees', async () => {
    const user = userEvent.setup()

    render(
      <TraceWaterfall
        onSelectSpan={vi.fn()}
        spans={spans}
      />
    )

    await user.click(screen.getByLabelText('Collapse query.run'))

    expect(screen.queryByText('db.query')).not.toBeInTheDocument()
  })
})
