import { useLiveQuery } from '@tanstack/react-db'
import { screen } from '@testing-library/react'
import { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { QuerySummaryDto } from '@/glue/api/schemas'

import { apiClient } from './api-client'
import { useCollections } from './collections-context'
import { makeWorksheet } from './test-fixtures'
import { renderWithProviders } from './test-utils'

vi.mock('./api-client', () => ({
  apiClient: {
    getDatabases: vi.fn(),
    getQueries: vi.fn(),
    getWorksheets: vi.fn()
  }
}))

const testWorksheet = makeWorksheet({
  content: 'SELECT * FROM users',
  name: 'Smoke Test Worksheet'
})

function WorksheetNames(): ReactElement {
  const { worksheets } = useCollections()

  const { data } = useLiveQuery((query) =>
    query.from({ worksheet: worksheets })
  )

  return (
    <ul>
      {data.map((worksheet) => (
        <li key={worksheet.id}>{worksheet.name}</li>
      ))}
    </ul>
  )
}

describe('collections', () => {
  it('serves seeded data without fetching from the api', async () => {
    renderWithProviders(<WorksheetNames />, {
      worksheets: [testWorksheet]
    })

    expect(await screen.findByText('Smoke Test Worksheet')).toBeInTheDocument()

    expect(apiClient.getWorksheets).not.toHaveBeenCalled()
  })

  // A query row is a union on `status`, and each variant carries only its own
  // fields. A merging write would keep a finished row's `result` on the
  // running row written over it — the slow insert response that lands after
  // the poller saw the query finish — and describe a state the type rules
  // out.
  it('replaces a query row instead of merging into it', async () => {
    const running: QuerySummaryDto = {
      content: 'SELECT 1',
      databaseId: 'db-1',
      id: 'query-1',
      queriedAt: 1000,
      status: 'running',
      worksheetId: 'ws-1'
    }

    const succeeded: QuerySummaryDto = {
      ...running,
      finishedAt: 1500,
      result: { rowCount: 1, truncated: false },
      status: 'succeeded'
    }

    const { collections } = renderWithProviders(<WorksheetNames />, {
      queries: [succeeded],
      worksheets: [testWorksheet]
    })

    await collections.queries.stateWhenReady()

    collections.queries.utils.writeUpsert(running)

    expect(collections.queries.get('query-1')).toEqual({
      ...running,
      $collectionId: expect.any(String),
      $key: 'query-1',
      $origin: 'remote',
      $synced: true
    })
  })
})
