import { ReactElement, ReactNode } from 'react'

import { QueryDto } from '@/main/queries'
import { TimeAgo } from './TimeAgo'

export function ResultSheet({
  children,
  isOpen,
  query
}: {
  children: ReactNode
  isOpen: boolean
  query: QueryDto | null
}): ReactElement {
  console.log(query)

  return (
    <div
      className="absolute bottom-0 left-2 right-2 border border-surface-0 bg-base rounded-t-md overflow-hidden transition-all flex flex-col text-xs min-h-0"
      style={{ height: isOpen ? '400px' : '0' }}
    >
      <div>
        <div className="flex items-center justify-between px-3 py-2">
          <div>
            Results (
            {query?.queriedAt && <TimeAgo timestamp={query.queriedAt} />})
          </div>
          {query?.result && (
            <div className="flex items-center text-subtext-0">
              <div>
                {Intl.NumberFormat().format(query.result.rowCount)}{' '}
                {query.result.rowCount > 1 ? 'rows' : 'row'}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  )
}
