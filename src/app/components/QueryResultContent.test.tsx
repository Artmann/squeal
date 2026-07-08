import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { canceledQueryMessage } from '@/glue/queries'
import { QueryDto } from '@/main/queries'
import { QueryResultContent } from './QueryResultContent'

// jsdom does not implement scrollTo, which the result table uses.
beforeAll(() => {
  Element.prototype.scrollTo = vi.fn()
})

const baseQuery: QueryDto = {
  content: 'SELECT * FROM film',
  databaseId: 'database-1',
  error: null,
  finishedAt: 1200,
  id: 'query-1',
  queriedAt: 1000,
  result: null,
  truncated: false,
  worksheetId: 'worksheet-1'
}

describe('QueryResultContent', () => {
  it('shows a running state with a cancel button', async () => {
    const onCancelQuery = vi.fn()

    render(
      <QueryResultContent
        isCancelPending={false}
        isQueryRunning
        query={{ ...baseQuery, finishedAt: null }}
        onCancelQuery={onCancelQuery}
      />
    )

    expect(screen.getByText('Running query')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel query' }))

    expect(onCancelQuery).toHaveBeenCalledTimes(1)
  })

  it('shows the result table for a successful query', () => {
    const query = {
      ...baseQuery,
      result: {
        fields: [{ name: 'title' }],
        rowCount: 1,
        rows: [{ title: 'Alien' }],
        truncated: false
      }
    }

    render(
      <QueryResultContent
        isCancelPending={false}
        isQueryRunning={false}
        query={query}
        onCancelQuery={() => undefined}
      />
    )

    expect(screen.getByText('Alien')).toBeInTheDocument()
  })

  it('shows the error for a failed query', () => {
    render(
      <QueryResultContent
        isCancelPending={false}
        isQueryRunning={false}
        query={{ ...baseQuery, error: 'syntax error at or near "FORM"' }}
        onCancelQuery={() => undefined}
      />
    )

    expect(screen.getByText('Query failed')).toBeInTheDocument()
    expect(
      screen.getByText('syntax error at or near "FORM"')
    ).toBeInTheDocument()
  })

  it('shows a canceled state for a canceled query', () => {
    render(
      <QueryResultContent
        isCancelPending={false}
        isQueryRunning={false}
        query={{ ...baseQuery, error: canceledQueryMessage }}
        onCancelQuery={() => undefined}
      />
    )

    expect(screen.getByText('Query canceled.')).toBeInTheDocument()
  })
})
