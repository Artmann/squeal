import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { QueryDto } from '@/glue/api/schemas'
import { ResultSheet } from './ResultSheet'

const successfulQuery: QueryDto = {
  content: 'SELECT * FROM film',
  databaseId: 'database-1',
  error: null,
  finishedAt: 1200,
  id: 'query-1',
  queriedAt: 1000,
  result: { fields: [], rowCount: 3, rows: [], truncated: false },
  truncated: false,
  worksheetId: 'worksheet-1'
}

const failedQuery: QueryDto = {
  ...successfulQuery,
  error: 'relation "films" does not exist',
  result: null
}

describe('ResultSheet', () => {
  it('shows the row count and execution time for a successful query', () => {
    render(
      <ResultSheet
        isOpen
        query={successfulQuery}
      >
        <div>content</div>
      </ResultSheet>
    )

    expect(screen.getByText('3 rows')).toBeInTheDocument()
    expect(screen.getByText('200ms')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('marks the row count as a floor when the result is truncated', () => {
    const truncatedQuery: QueryDto = {
      ...successfulQuery,
      result: { fields: [], rowCount: 10_000, rows: [], truncated: true },
      truncated: true
    }

    render(
      <ResultSheet
        isOpen
        query={truncatedQuery}
      >
        <div>content</div>
      </ResultSheet>
    )

    expect(screen.getByText('10,000+ rows')).toBeInTheDocument()
  })

  it('falls back to a generic header for a failed query', () => {
    render(
      <ResultSheet
        isOpen
        query={failedQuery}
      >
        <div>content</div>
      </ResultSheet>
    )

    expect(screen.getByText('Results')).toBeInTheDocument()
  })

  it('renders a resize handle', () => {
    render(
      <ResultSheet
        isOpen
        query={successfulQuery}
      >
        <div>content</div>
      </ResultSheet>
    )

    expect(
      screen.getByRole('separator', { name: 'Resize results panel' })
    ).toBeInTheDocument()
  })
})
