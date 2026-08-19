import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueryDto } from '@/glue/api/schemas'
import { DatabaseDto } from '@/glue/databases'

import { renderWithProviders } from '../test-utils'
import { StatusBar } from './StatusBar'

vi.mock('../api-client', () => ({
  apiClient: {
    getDatabaseSchema: vi.fn(async () => ({
      databaseName: 'pagila',
      tables: []
    })),
    getDatabases: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getUpdateStatus: vi.fn(async () => ({
      currentVersion: '1.4.2',
      lastCheckedAt: null,
      message: null,
      releaseNotesUrl: null,
      state: 'idle',
      version: null
    })),
    getWorksheets: vi.fn(async () => [])
  }
}))

import { apiClient } from '../api-client'

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
  sortOrder: null,
  type: 'postgres'
}

/**
 * A row count as the reader's own machine would render it.
 *
 * Spelled this way rather than as a literal because the component formats for
 * the ambient locale, and not every locale writes ASCII digits — `ar-EG` gives
 * `١٠٠`, `fa-IR` `۱۰۰`. A hard-coded `'100'` turns these red on a machine set
 * to one of them, and nothing in the vitest setup pins a locale.
 */
function count(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function query(overrides: Partial<QueryDto> = {}): QueryDto {
  return {
    content: 'SELECT * FROM film',
    databaseId: 'database-1',
    error: null,
    finishedAt: 3373,
    id: 'q-1',
    queriedAt: 1000,
    result: {
      fields: [{ name: 'title' }],
      rowCount: 100,
      rows: [{ title: 'Alien' }],
      truncated: false
    },
    worksheetId: 'ws-1',
    ...overrides
  }
}

function renderStatusBar(
  database: DatabaseDto | undefined,
  current?: QueryDto
) {
  return renderWithProviders(
    <StatusBar
      cursorPosition={undefined}
      database={database}
      query={current}
      saveState="idle"
    />,
    { databases: database ? [database] : [] }
  )
}

describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the connection and reads its server version', async () => {
    renderStatusBar(testDatabase)

    expect(screen.getByText('Pagila')).toBeInTheDocument()

    await waitFor(() => {
      expect(apiClient.getDatabaseSchema).toHaveBeenCalledWith('database-1')
    })
  })

  it('says so when the worksheet has no connection', () => {
    renderStatusBar(undefined)

    expect(screen.getByText('No database')).toBeInTheDocument()
    expect(apiClient.getDatabaseSchema).not.toHaveBeenCalled()
  })

  // The version rides along with the schema, and there is no schema to load for
  // a connection whose stored secret cannot be read — asking spends a failing
  // request on an answer the database list already gave.
  it('asks for no schema when the stored details cannot be read', () => {
    renderStatusBar({ ...testDatabase, connectionInfo: null })

    expect(screen.getByText('Pagila')).toBeInTheDocument()
    expect(apiClient.getDatabaseSchema).not.toHaveBeenCalled()
  })

  // The row count in the status bar is the only place a truncated result says
  // so once the results pane has scrolled away, and `+` is the whole of the
  // saying. Without it the reader is told the query returned exactly 100 rows
  // when the driver stopped counting at 100 — a number they may go on to trust.
  //
  // Truncation reaches here through `query.result.truncated`, which is now the
  // only place it is carried; the copy `QueryDto` used to hold beside the
  // result had no readers and is gone. These cases are what stop the remaining
  // one from being dropped or inverted unnoticed.
  it('marks a truncated row count so the number is not read as a total', () => {
    renderStatusBar(
      testDatabase,
      query({
        result: {
          fields: [{ name: 'title' }],
          rowCount: 100,
          rows: [{ title: 'Alien' }],
          truncated: true
        }
      })
    )

    expect(
      screen.getByText(`${count(100)}+ rows in 2.37 s`)
    ).toBeInTheDocument()
  })

  it('leaves a complete row count unmarked', () => {
    renderStatusBar(testDatabase, query())

    expect(screen.getByText(`${count(100)} rows in 2.37 s`)).toBeInTheDocument()
  })

  // Seven digits because every CLDR locale groups them — swept all 110 the
  // runtime carries, and none leaves 1234567 bare. Four would not do: a dozen
  // locales, Spanish and Italian among them, write 1234 unseparated.
  //
  // Two assertions rather than one. The absence catches a count printed
  // straight through `String()`; the presence catches one that is formatted but
  // no longer the number — `notation: 'compact'` renders `1.2M`, which the
  // absence alone waves through.
  it('groups a large row count so the digits can be read', () => {
    renderStatusBar(
      testDatabase,
      query({
        result: {
          fields: [{ name: 'title' }],
          rowCount: 1234567,
          rows: [{ title: 'Alien' }],
          truncated: false
        }
      })
    )

    const summary = screen.getByText(/rows in 2\.37 s$/).textContent

    expect({
      grouped: summary?.includes(count(1234567)),
      ungrouped: summary?.includes('1234567')
    }).toEqual({ grouped: true, ungrouped: false })
  })
})
