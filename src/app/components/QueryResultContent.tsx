import { BanIcon } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'

import type { QueryResultDto, QuerySummaryDto } from '@/glue/api/schemas'

import { QueryResultEmpty } from './QueryResultEmpty'
import { QueryResultTable } from './QueryResultTable'
import type { ResultSearchView } from './query-result-search'
import { toQueryErrorParts } from './query-error-parts'

interface QueryResultContentProps {
  databaseName: string | undefined
  query: QuerySummaryDto | undefined
  /** The query's rows, which arrive separately from the query itself. */
  result?: QueryResultDto
  /** Why the rows could not be loaded, when they could not. */
  resultError?: string
  search?: ResultSearchView
}

export function QueryResultContent({
  databaseName,
  query,
  result,
  resultError,
  search
}: QueryResultContentProps): ReactElement {
  switch (query?.status) {
    case undefined:
      return <QueryResultEmpty />
    case 'canceled':
      return <CanceledQuery />
    case 'failed':
      return (
        <FailedQuery
          error={query.error}
          durationMs={query.finishedAt - query.queriedAt}
        />
      )
    case 'running':
      return (
        <RunningQuery
          databaseName={databaseName}
          since={query.queriedAt}
        />
      )
    case 'succeeded':
      break
  }

  if (result !== undefined) {
    // DML and DDL come back with no fields and no rows. There are no columns
    // to head a grid with, so say what happened instead of drawing an empty
    // one.
    if (result.fields.length === 0 && result.rows.length === 0) {
      return <NoResultSet rowCount={result.rowCount} />
    }

    return (
      <QueryResultTable
        queryId={query.id}
        result={result}
        search={search}
      />
    )
  }

  if (resultError !== undefined) {
    return (
      <FailedQuery
        error={resultError}
        durationMs={null}
      />
    )
  }

  return <LoadingResult />
}

function CanceledQuery(): ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex items-center gap-2 text-[12.5px] text-text2">
        <BanIcon className="size-4 shrink-0" />
        Query canceled.
      </div>
    </div>
  )
}

function LoadingResult(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-border border-t-accent" />

      <p className="text-[12.5px] text-text2">Loading results…</p>
    </div>
  )
}

function FailedQuery({
  durationMs,
  error
}: {
  durationMs: number | null
  error: string
}): ReactElement {
  const { detail, title } = toQueryErrorParts(error)

  return (
    <div className="p-4">
      <div className="rounded-lg border border-[var(--err-border)] bg-[var(--err-bg)] px-4 py-[13px] font-mono text-[12px] leading-[1.6]">
        <div className="mb-[6px] font-semibold text-[var(--err)]">{title}</div>

        {detail !== undefined && (
          <pre className="whitespace-pre-wrap text-text2">{detail}</pre>
        )}
      </div>

      {durationMs !== null && (
        <p className="mt-[10px] text-[11.5px] text-text3">
          Failed after {Intl.NumberFormat().format(durationMs)} ms
        </p>
      )}
    </div>
  )
}

/**
 * A statement that ran and returned no result set. For DML the adapters put
 * the affected-row count in `rowCount`, so that is shown when there is one.
 */
function NoResultSet({ rowCount }: { rowCount: number }): ReactElement {
  const noun = rowCount === 1 ? 'row' : 'rows'

  return (
    <div className="flex h-full flex-col items-center justify-center gap-[6px] p-6 text-center">
      <p className="text-[12.5px] text-text2">No rows returned.</p>

      {rowCount > 0 && (
        <p className="text-[11.5px] text-text3">
          {Intl.NumberFormat().format(rowCount)} {noun} affected.
        </p>
      )}
    </div>
  )
}

function RunningQuery({
  databaseName,
  since
}: {
  databaseName: string | undefined
  since: number
}): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-border border-t-accent" />

      <p className="text-[12.5px] text-text2">
        {databaseName ? `Running on ${databaseName}…` : 'Running…'}
      </p>

      {/* The design shows static text, but a long query with no sign of
          progress reads as a hang. */}
      <p className="text-[11.5px] text-text3">
        <ElapsedTime since={since} />
      </p>
    </div>
  )
}

function ElapsedTime({ since }: { since: number }): ReactElement {
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250)

    return () => clearInterval(interval)
  }, [])

  const seconds = Math.max(0, (now - since) / 1000)

  const formatted =
    seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)
          .toString()
          .padStart(2, '0')}s`

  return <>{formatted}</>
}
