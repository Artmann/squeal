import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuerySummaryDto } from '@/glue/api/schemas'

import { stubElementSize } from '../test-element-size'
import { QueryResultContent } from './QueryResultContent'

beforeEach(() => {
  // jsdom does not implement scrollTo, which the result table uses, and the
  // virtualized rows need a viewport with a real height.
  Element.prototype.scrollTo = vi.fn()
  stubElementSize()
})

const queryFields = {
  content: 'SELECT * FROM film',
  databaseId: 'database-1',
  id: 'query-1',
  queriedAt: 1000,
  worksheetId: 'worksheet-1'
}

const runningQuery: QuerySummaryDto = { ...queryFields, status: 'running' }

const successfulQuery: QuerySummaryDto = succeededQuery(queryFields.content, 1)

function failedQuery(error: string): QuerySummaryDto {
  return { ...queryFields, error, finishedAt: 1200, status: 'failed' }
}

function succeededQuery(content: string, rowCount: number): QuerySummaryDto {
  return {
    ...queryFields,
    content,
    finishedAt: 1200,
    result: { rowCount, truncated: false },
    status: 'succeeded'
  }
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
        query={runningQuery}
      />
    )

    expect(screen.getByText('Running on Pagila…')).toBeInTheDocument()
  })

  it('falls back to a generic running label without a database', () => {
    render(
      <QueryResultContent
        databaseName={undefined}
        query={runningQuery}
      />
    )

    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  it('shows the result table for a successful query', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={successfulQuery}
        result={{
          fields: [{ name: 'title' }],
          rowCount: 1,
          rows: [{ title: 'Alien' }],
          truncated: false
        }}
      />
    )

    expect(screen.getByText('Alien')).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'title' })
    ).toBeInTheDocument()
  })

  // The query says it has rows before they have arrived, and "No results yet"
  // would be a lie about a query that just produced some.
  it('shows a loading state while the rows of a finished query arrive', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={successfulQuery}
      />
    )

    expect(screen.getByText('Loading results…')).toBeInTheDocument()
    expect(screen.queryByText('No results yet')).not.toBeInTheDocument()
  })

  it('says so when the rows could not be loaded', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={successfulQuery}
        resultError="Could not load the rows for this query. Run it again to see them."
      />
    )

    expect(
      screen.getByText(
        'Could not load the rows for this query. Run it again to see them.'
      )
    ).toBeInTheDocument()
  })

  it('keeps the column headers over an empty SELECT and says no rows came back', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={succeededQuery(queryFields.content, 0)}
        result={{
          fields: [{ name: 'title' }],
          rowCount: 0,
          rows: [],
          truncated: false
        }}
      />
    )

    expect(
      screen.getByRole('columnheader', { name: 'title' })
    ).toBeInTheDocument()
    expect(screen.getByText('No rows returned.')).toBeInTheDocument()
  })

  it('shows no table for a statement that returns no result set', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={succeededQuery(
          "UPDATE film SET title = 'Alien' WHERE film_id < 4",
          3
        )}
        result={{ fields: [], rowCount: 3, rows: [], truncated: false }}
      />
    )

    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('No rows returned.')).toBeInTheDocument()
    expect(screen.getByText('3 rows affected.')).toBeInTheDocument()
  })

  it('leaves out the affected count when the statement changed nothing', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={succeededQuery('CREATE TABLE notes (id integer)', 0)}
        result={{ fields: [], rowCount: 0, rows: [], truncated: false }}
      />
    )

    expect(screen.getByText('No rows returned.')).toBeInTheDocument()
    expect(screen.queryByText(/affected/)).not.toBeInTheDocument()
  })

  it('splits a driver error into a title and its detail', () => {
    render(
      <QueryResultContent
        databaseName="Pagila"
        query={failedQuery(
          'ERROR 42P01: relation "Employes" does not exist\nHINT:  Perhaps you meant "Employees".'
        )}
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
        query={failedQuery('syntax error at or near "FORM"')}
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
        query={{ ...queryFields, finishedAt: 1200, status: 'canceled' }}
      />
    )

    expect(screen.getByText('Query canceled.')).toBeInTheDocument()
    expect(screen.queryByText(/Failed after/)).not.toBeInTheDocument()
  })
})
