import { ReactElement, ReactNode, useCallback, useState } from 'react'

import { QueryDto } from '@/main/queries'
import { TimeAgo } from './TimeAgo'
import { cn } from '../lib/utils'

const defaultHeight = 400
const minHeight = 80

export function ResultSheet({
  children,
  isOpen,
  query
}: {
  children: ReactNode
  isOpen: boolean
  query: QueryDto | null
}): ReactElement {
  const [height, setHeight] = useState(defaultHeight)
  const [isDragging, setIsDragging] = useState(false)

  const executionTime =
    query && query.queriedAt && query.finishedAt
      ? query.finishedAt - query.queriedAt
      : null

  const isSuccessful = query?.result && !query.error

  const handleDragStart = useCallback(
    (event: React.MouseEvent) => {
      const startY = event.clientY
      const startHeight = height

      setIsDragging(true)

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const maxHeight = window.innerHeight * 0.8
        const newHeight = Math.min(
          maxHeight,
          Math.max(minHeight, startHeight + (startY - moveEvent.clientY))
        )

        setHeight(newHeight)
      }

      const handleMouseUp = () => {
        setIsDragging(false)
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [height]
  )

  return (
    <div
      className={cn(
        'absolute bottom-0 left-2 right-2',
        'border border-surface-0 rounded-t-md',
        'bg-base overflow-hidden',
        'flex flex-col text-xs min-h-0',
        !isDragging && 'transition-all'
      )}
      style={{ height: isOpen ? `${height}px` : '0' }}
    >
      <div
        className="h-1 cursor-row-resize hover:bg-mauve/30 flex-shrink-0"
        onMouseDown={handleDragStart}
      />

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
