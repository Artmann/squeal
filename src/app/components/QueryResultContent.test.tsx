import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { canceledQueryMessage } from '@/glue/queries'
import type { QueryDto } from '@/glue/api/schemas'

import { stubElementSize } from '../test-element-size'
import { QueryResultContent } from './QueryResultContent'

beforeEach(() => {
  // jsdom does not implement scrollTo, which the result table uses, and the
  // virtualized rows need a viewport with a real height.
  Element.prototype.scrollTo = vi.fn()
  stubElementSize()
})

const baseQuery: QueryDto = {
  content: 'SELECT * FROM film',
  databaseId: 'database-1',
  error: null,
  finishedAt: 1200,
  id: 'query-1',
  queriedAt: 1000,
  result: null,
  worksheetId: 'worksheet-1'
}

describe('QueryResultContent', () => {
  it('shows the idle state before anything has run', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={undefined}
      />
    )

    expect(screen.getByText('No results yet')).toBeInTheDocument()
  })

  it('names the database it is running against', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={{ ...baseQuery, finishedAt: null }}
      />
    )

    expect(screen.getByText('Running on Pagila…')).toBeInTheDocument()
  })

  it('falls back to a generic running label without a database', () => {
    render(
      <QueryResultContent
        databaseName={undefined}
        query={{ ...baseQuery, finishedAt: null }}
      />
    )

    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  it('shows the result table for a successful query', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={{
          ...baseQuery,
          result: {
            fields: [{ name: 'title' }],
            rowCount: 1,
            rows: [{ title: 'Alien' }],
            truncated: false
          }
        }}
      />
    )

    expect(screen.getByText('Alien')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'title' })
    ).toBeInTheDocument()
  })

  it('splits a driver error into a title and its detail', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={{
          ...baseQuery,
          error:
            'ERROR 42P01: relation "Employes" does not exist\nHINT:  Perhaps you meant "Employees".'
        }}
      />
    )

    expect(
      screen.getByText('ERROR 42P01: relation "Employes" does not exist')
    ).toBeInTheDocument()
    expect(
      screen.getByText(/HINT:\s+Perhaps you meant "Employees"\./)
    ).toBeInTheDocument()
    expect(screen.getByText('Failed after 200 ms')).toBeInTheDocument()
  })

  it('renders a single-line error without a detail block', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={{ ...baseQuery, error: 'syntax error at or near "FORM"' }}
      />
    )

    expect(
      screen.getByText('syntax error at or near "FORM"')
    ).toBeInTheDocument()
  })

  it('shows a quiet canceled state rather than the error card', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={{ ...baseQuery, error: canceledQueryMessage }}
      />
    )

    expect(screen.getByText('Query canceled.')).toBeInTheDocument()
    expect(screen.queryByText(/Failed after/)).not.toBeInTheDocument()
  })
})
