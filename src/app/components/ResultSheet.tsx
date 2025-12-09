import { ReactElement, ReactNode } from 'react'

import { QueryDto } from '@/main/queries'
import { TimeAgo } from './TimeAgo'
import { cn } from '../lib/utils'

export function ResultSheet({
  children,
  isOpen,
  query
}: {
  children: ReactNode
  isOpen: boolean
  query: QueryDto | null
}): ReactElement {
  const executionTime =
    query && query.queriedAt && query.finishedAt
      ? query.finishedAt - query.queriedAt
      : null

  const isSuccessful = query?.result && !query.error

  return (
    <div
      className={`
        absolute bottom-0 left-2 right-2
        border border-surface-0 rounded-t-md
        bg-base
        overflow-hidden transition-all
        flex flex-col
        text-xs
        min-h-0
      `}
      style={{ height: isOpen ? '400px' : '0' }}
    >
      <div>
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-0">
          <div className={cn(isSuccessful ? 'text-mauve' : '')}>
            Results (
            {query?.queriedAt && <TimeAgo timestamp={query.queriedAt} />})
          </div>
          {query?.result && (
            <div className="flex items-center gap-4 text-subtext-0">
              <div>
                {Intl.NumberFormat().format(query.result.rowCount)}{' '}
                {query.result.rowCount > 1 ? 'rows' : 'row'}
              </div>
              {executionTime && <div>{executionTime} ms</div>}
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
