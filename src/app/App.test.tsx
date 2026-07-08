import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DatabaseDto } from '@/glue/databases'
import { App } from './App'
import { renderWithProviders } from './test-utils'

const testDatabase: DatabaseDto = {
  connectionInfo: {
    database: 'pagila',
    host: 'localhost',
    port: 5432,
    username: 'postgres'
  },
  createdAt: 1,
  id: 'database-1',
  name: 'Pagila',
  type: 'postgres'
}

describe('App', () => {
  it('shows the getting started screen when there are no databases', () => {
    renderWithProviders(<App />, { databases: [], queries: [], worksheets: [] })

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
  })

  it('hides the getting started screen when a database exists', () => {
    renderWithProviders(<App />, {
      databases: [testDatabase],
      queries: [],
      worksheets: []
    })

    expect(screen.queryByText('Connect a database')).not.toBeInTheDocument()
  })
})
