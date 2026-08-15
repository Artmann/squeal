import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../test-utils'
import { useStartQuery } from './use-start-query'

vi.mock('../api-client', () => ({
  apiClient: {
    createQuery: vi.fn(),
    getDatabases: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getWorksheets: vi.fn(async () => [])
  }
}))

import { apiClient } from '../api-client'

function StartProbe(): ReactElement {
  const startQuery = useStartQuery()

  return (
    <button
      onClick={() =>
        startQuery({
          content: 'SELECT 1;',
          databaseId: 'database-1',
          worksheetId: 'ws-1'
        })
      }
      type="button"
    >
      start
    </button>
  )
}

describe('useStartQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates the query from the given content', async () => {
    vi.mocked(apiClient.createQuery).mockResolvedValue({
      query: {
        content: 'SELECT 1;',
        databaseId: 'database-1',
        error: null,
        finishedAt: null,
        id: 'q-1',
        queriedAt: 1,
        result: null,
        truncated: false,
        worksheetId: 'ws-1'
      }
    })

    const { collections } = renderWithProviders(<StartProbe />, { queries: [] })

    // `AppShell` preloads the collections in the real app; the probe renders
    // without it, and the insert handler writes the response back.
    await act(async () => {
      await collections.queries.preload()
    })

    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    await waitFor(() => {
      expect(apiClient.createQuery).toHaveBeenCalledWith(
        {
          content: 'SELECT 1;',
          databaseId: 'database-1',
          id: expect.any(String),
          queriedAt: expect.any(Number),
          worksheetId: 'ws-1'
        },
        expect.anything()
      )
    })
  })

  it('tells the user when the query could not be created', async () => {
    vi.mocked(apiClient.createQuery).mockRejectedValue(
      new Error('Failed to reach the server')
    )

    renderWithProviders(<StartProbe />, { queries: [] })

    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    expect(await screen.findByText('Query failed')).toBeInTheDocument()
    expect(
      await screen.findByText('Failed to reach the server')
    ).toBeInTheDocument()
  })
})
