import dayjs from 'dayjs'
import { BanIcon, Loader2Icon, XCircleIcon } from 'lucide-react'
import { ReactElement, useEffect, useState } from 'react'

import { QueryResultTable } from './QueryResultTable'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { canceledQueryMessage } from '@/glue/queries'
import { QueryDto } from '@/main/queries'

interface QueryResultContentProps {
  isCancelPending: boolean
  isQueryRunning: boolean
  query: QueryDto | undefined
  onCancelQuery: () => void
}

export function QueryResultContent({
  isCancelPending,
  isQueryRunning,
  query,
  onCancelQuery
}: QueryResultContentProps): ReactElement {
  return (
    <>
      {isQueryRunning && (
        <div className="w-full h-full flex justify-center items-center">
          <div className="w-full max-w-sm flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-medium">
              <Loader2Icon className="size-4 animate-spin text-mauve" />
              Running query
            </h2>

            <Separator />

            <div className="flex flex-col gap-1 text-subtext-0 text-sm">
              <div className="flex items-center justify-between">
                <div>Elapsed</div>
                <div className="text-right font-mono tabular-nums text-text">
                  {query?.queriedAt && <ElapsedTime since={query.queriedAt} />}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>Started</div>
                <div className="text-right">
                  {query?.queriedAt &&
                    dayjs(query.queriedAt).format('HH:mm:ss')}
                </div>
              </div>
            </div>

            <Button
              className="self-start"
              disabled={isCancelPending}
              size="sm"
              variant="outline"
              onClick={onCancelQuery}
            >
              {isCancelPending ? 'Canceling…' : 'Cancel query'}
            </Button>
          </div>
        </div>
      )}

      {query?.result && <QueryResultTable result={query.result} />}

      {query?.error &&
        (query.error === canceledQueryMessage ? (
          <div className="w-full h-full flex justify-center items-center p-6">
            <div className="flex items-center gap-2 text-subtext-0 text-sm">
              <BanIcon className="size-4 shrink-0" />
              Query canceled.
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex justify-center items-center p-6">
            <div className="w-full max-w-lg flex flex-col gap-3">
              <div className="flex items-center gap-2 text-red font-medium text-sm">
                <XCircleIcon className="size-4 shrink-0" />
                Query failed
              </div>

              <pre className="text-xs text-subtext-0 font-mono whitespace-pre-wrap bg-surface-0 rounded-md p-3 border border-surface-1">
                {query.error}
              </pre>
            </div>
          </div>
        ))}
    </>
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
