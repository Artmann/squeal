import { useLiveQuery } from '@tanstack/react-db'
import { screen } from '@testing-library/react'
import { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

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
})
