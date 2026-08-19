import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SchemaInfo } from '@/databases/adapter'
import type { QueryDto, UpdateStatusResponse } from '@/glue/api/schemas'

import { renderWithProviders } from '../test-utils'
import { StatusBar } from './StatusBar'

// `StatusBar` mounts `useServerVersion` and `UpdateIndicator`, and both fetch.
// Seeded here so they read the cache instead: unseeded they are six real
// requests to `127.0.0.1:7847`, which is the port `yarn start` binds — measured
// by listening on it. They resolve to nothing this file asserts on, so all
// three cases pass either way; what it costs is two `RequestError` stack traces
// printed above the assertion diff whenever one of them does fail.
const schema: SchemaInfo = { databaseName: 'pagila', tables: [] }
const updateStatus: UpdateStatusResponse = {
  currentVersion: '1.2.0',
  lastCheckedAt: 1_700_000_000_000,
  message: 'Updates are only available in a packaged build.',
  releaseNotesUrl: null,
  state: 'unsupported',
  version: null
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
    databaseId: 'db-1',
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

function renderStatusBar(current: QueryDto): void {
  renderWithProviders(
    <StatusBar
      cursorPosition={undefined}
      databaseId="db-1"
      databaseName="Pagila"
      query={current}
      saveState="saved"
    />,
    { schemas: { 'db-1': schema }, updateStatus }
  )
}

// The row count in the status bar is the only place a truncated result says so
// once the results pane has scrolled away, and `+` is the whole of the saying.
// Without it the reader is told the query returned exactly 100 rows when the
// driver stopped counting at 100 — a number they may go on to trust.
//
// Truncation reaches here through `query.result.truncated`, which is now the
// only place it is carried; the copy `QueryDto` used to hold beside the result
// had no readers and is gone. These cases are what stop the remaining one from
// being dropped or inverted unnoticed.
//
// Scoped to the row-count summary. The connection-health dot, its tooltips and
// the save-state label share this component and are covered by nothing — each
// can be replaced with a constant and every case below stays green.
describe('StatusBar', () => {
  it('marks a truncated row count so the number is not read as a total', () => {
    renderStatusBar(
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
    renderStatusBar(query())

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
