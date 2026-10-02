import { describe, expect, it } from 'vitest'

import type { QueryDto, QueryResultDto } from '@/glue/api/schemas'

import {
  buildWorksheetMessages,
  maxWorksheetMessages
} from './use-worksheet-messages'

const queryFields = {
  content: 'SELECT 1',
  databaseId: 'db-1',
  id: 'q-1',
  queriedAt: 1000,
  worksheetId: 'ws-1'
}

type QueryFields = typeof queryFields

function failed(error: string): QueryDto {
  return { ...queryFields, error, finishedAt: 1200, status: 'failed' }
}

function running(fields: Partial<QueryFields> = {}): QueryDto {
  return { ...queryFields, ...fields, status: 'running' }
}

function succeeded(result: Partial<QueryResultDto>): QueryDto {
  return {
    ...queryFields,
    finishedAt: 1200,
    result: {
      fields: [{ name: 'id' }],
      rowCount: 100,
      rows: [],
      truncated: false,
      ...result
    },
    status: 'succeeded'
  }
}

describe('buildWorksheetMessages', () => {
  it('returns nothing for a worksheet that has not run anything', () => {
    expect(buildWorksheetMessages([])).toEqual([])
  })

  it('logs the first line of the statement when it runs', () => {
    const messages = buildWorksheetMessages([
      running({ content: 'SELECT *\nFROM film\nLIMIT 10' })
    ])

    expect(messages[0]).toEqual({
      id: 'q-1:run',
      text: 'SELECT *',
      timestamp: 1000
    })
  })

  it('logs the row count and duration on success', () => {
    const messages = buildWorksheetMessages([succeeded({ rowCount: 100 })])

    expect(messages[1]).toEqual({
      id: 'q-1:result',
      text: '100 rows in 200 ms',
      timestamp: 1200
    })
  })

  it('marks a truncated result', () => {
    const messages = buildWorksheetMessages([
      succeeded({ rowCount: 10000, truncated: true })
    ])

    expect(messages[1]?.text).toEqual('10,000+ rows in 200 ms')
  })

  it('uses the singular noun for one row', () => {
    const messages = buildWorksheetMessages([succeeded({ rowCount: 1 })])

    expect(messages[1]?.text).toEqual('1 row in 200 ms')
  })

  it('logs the first line of a failure', () => {
    const messages = buildWorksheetMessages([
      failed('ERROR 42P01: relation "Employes" does not exist\nHINT: typo?')
    ])

    expect(messages[1]).toEqual({
      id: 'q-1:error',
      text: 'ERROR 42P01: relation "Employes" does not exist',
      timestamp: 1200
    })
  })

  it('logs a cancel as its own line rather than an error', () => {
    const messages = buildWorksheetMessages([
      { ...queryFields, finishedAt: 1200, status: 'canceled' }
    ])

    expect(messages[1]).toEqual({
      id: 'q-1:error',
      text: 'Query canceled.',
      timestamp: 1200
    })
  })

  it('logs nothing beyond the statement while a query is still running', () => {
    const messages = buildWorksheetMessages([running()])

    expect(messages).toEqual([
      { id: 'q-1:run', text: 'SELECT 1', timestamp: 1000 }
    ])
  })

  it('orders messages oldest first regardless of input order', () => {
    const messages = buildWorksheetMessages([
      running({ content: 'SECOND', id: 'q-2', queriedAt: 2000 }),
      running({ content: 'FIRST', id: 'q-1', queriedAt: 1000 })
    ])

    expect(messages.map((message) => message.text)).toEqual(['FIRST', 'SECOND'])
  })

  it('caps the log and keeps the newest entries', () => {
    const queries = Array.from({ length: maxWorksheetMessages + 50 }, (_, i) =>
      running({ content: `SELECT ${i}`, id: `q-${i}`, queriedAt: 1000 + i })
    )

    const messages = buildWorksheetMessages(queries)

    expect(messages).toHaveLength(maxWorksheetMessages)
    expect(messages[messages.length - 1]?.text).toEqual(
      `SELECT ${maxWorksheetMessages + 49}`
    )
  })
})
