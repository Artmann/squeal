import { Either, Schema } from 'effect'
import { describe, expect, it } from 'vitest'

import { GetQueriesResponse, GetQueryResponse } from './schemas'

const queryFields = {
  content: 'select 1',
  databaseId: 'database-1',
  id: 'query-1',
  queriedAt: 1_000,
  worksheetId: 'worksheet-1'
}

const fullResult = {
  fields: [{ name: 'value' }],
  rowCount: 1,
  rows: [{ value: 1 }],
  truncated: false
}

const decodeQuery = Schema.decodeUnknownEither(GetQueryResponse)
const decodeSummaries = Schema.decodeUnknownEither(GetQueriesResponse)

describe('QueryDto', () => {
  it('decodes each status with the fields legal for it', () => {
    const queries = [
      { ...queryFields, status: 'running' },
      {
        ...queryFields,
        finishedAt: 2_000,
        result: fullResult,
        status: 'succeeded'
      },
      {
        ...queryFields,
        error: 'relation "missing" does not exist',
        finishedAt: 2_000,
        status: 'failed'
      },
      { ...queryFields, finishedAt: 2_000, status: 'canceled' }
    ]

    expect(
      queries.map((query) => decodeQuery({ query }).pipe(Either.isRight))
    ).toEqual([true, true, true, true])
  })

  it('rejects a running query that carries a result', () => {
    const decoded = decodeQuery({
      query: { ...queryFields, result: fullResult, status: 'running' }
    })

    expect(Either.isLeft(decoded)).toEqual(true)
  })

  it('rejects a succeeded query that carries an error', () => {
    const decoded = decodeQuery({
      query: {
        ...queryFields,
        error: 'relation "missing" does not exist',
        finishedAt: 2_000,
        result: fullResult,
        status: 'succeeded'
      }
    })

    expect(Either.isLeft(decoded)).toEqual(true)
  })

  it('rejects a succeeded query without a result', () => {
    const decoded = decodeQuery({
      query: { ...queryFields, finishedAt: 2_000, status: 'succeeded' }
    })

    expect(Either.isLeft(decoded)).toEqual(true)
  })

  it('rejects a failed query without an error', () => {
    const decoded = decodeQuery({
      query: { ...queryFields, finishedAt: 2_000, status: 'failed' }
    })

    expect(Either.isLeft(decoded)).toEqual(true)
  })
})

describe('QuerySummaryDto', () => {
  it('decodes a succeeded query whose result has only its size', () => {
    const query = {
      ...queryFields,
      finishedAt: 2_000,
      result: { rowCount: 1, truncated: false },
      status: 'succeeded'
    }

    expect(decodeSummaries({ queries: [query] })).toEqual(
      Either.right({ queries: [query] })
    )
  })

  it('rejects a running query that carries a result', () => {
    const decoded = decodeSummaries({
      queries: [
        {
          ...queryFields,
          result: { rowCount: 1, truncated: false },
          status: 'running'
        }
      ]
    })

    expect(Either.isLeft(decoded)).toEqual(true)
  })
})
