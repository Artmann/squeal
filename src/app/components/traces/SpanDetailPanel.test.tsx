import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SpanDto } from '@/main/tracing/routes'

import { SpanDetailPanel } from './SpanDetailPanel'

const span: SpanDto = {
  attributes: {
    'db.statement': 'SELECT * FROM nope',
    'db.system': 'postgres'
  },
  durationMs: 42,
  events: [
    {
      attributes: {
        'exception.message': 'relation "nope" does not exist',
        'exception.stacktrace': 'Error: relation "nope" does not exist\n  at x',
        'exception.type': 'Error'
      },
      name: 'exception',
      time: 1700000000100
    }
  ],
  id: 'span-1',
  kind: 'internal',
  name: 'db.query',
  parentSpanId: 'parent-1',
  serviceName: 'main',
  startedAt: 1700000000000,
  status: 'error',
  statusMessage: 'relation "nope" does not exist',
  traceId: 'trace-1'
}

describe('SpanDetailPanel', () => {
  it('shows the span metadata and attributes', () => {
    render(<SpanDetailPanel span={span} />)

    expect(screen.getByText('db.query')).toBeInTheDocument()
    expect(screen.getByText('db.statement')).toBeInTheDocument()
    expect(screen.getByText('SELECT * FROM nope')).toBeInTheDocument()
    expect(screen.getByText('42ms')).toBeInTheDocument()
  })

  it('shows exception events with their stack trace', () => {
    render(<SpanDetailPanel span={span} />)

    expect(screen.getByText('exception')).toBeInTheDocument()
    expect(screen.getByText(/at x/)).toBeInTheDocument()
  })

  it('has no close button of its own', () => {
    render(<SpanDetailPanel span={span} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
