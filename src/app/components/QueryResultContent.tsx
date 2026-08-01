import { BanIcon } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'

import { canceledQueryMessage } from '@/glue/queries'
import type { QueryDto } from '@/glue/api/schemas'

import { QueryResultEmpty } from './QueryResultEmpty'
import { QueryResultTable } from './QueryResultTable'
import { toQueryErrorParts } from './query-error-parts'

interface QueryResultContentProps {
  databaseName: string | undefined
  isQueryRunning: boolean
  query: QueryDto | undefined
}

export function QueryResultContent({
  databaseName,
  isQueryRunning,
  query
}: QueryResultContentProps): ReactElement {
  if (isQueryRunning) {
    return (
      <RunningQuery
        databaseName={databaseName}
        since={query?.queriedAt}
      />
    )
  }

  if (query?.error !== undefined && query?.error !== null) {
    return (
      <FailedQuery
        error={query.error}
        durationMs={
          query.finishedAt === null ? null : query.finishedAt - query.queriedAt
        }
      />
    )
  }

  if (query?.result) {
    return <QueryResultTable result={query.result} />
  }

  return <QueryResultEmpty />
}

function FailedQuery({
  durationMs,
  error
}: {
  durationMs: number | null
  error: string
}): ReactElement {
  if (error === canceledQueryMessage) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex items-center gap-2 text-[12.5px] text-text2">
          <BanIcon className="size-4 shrink-0" />
          Query canceled.
        </div>
      </div>
    )
  }

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

function RunningQuery({
  databaseName,
  since
}: {
  databaseName: string | undefined
  since: number | undefined
}): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="size-5 animate-spin rounded-full border-2 border-border border-t-accent" />

      <p className="text-[12.5px] text-text2">
        {databaseName ? `Running on ${databaseName}…` : 'Running…'}
      </p>

      {/* The design shows static text, but a long query with no sign of
          progress reads as a hang. */}
      {since !== undefined && (
        <p className="text-[11.5px] text-text3">
          <ElapsedTime since={since} />
        </p>
      )}
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
