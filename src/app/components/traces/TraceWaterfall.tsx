import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { ReactElement, useMemo, useState } from 'react'

import { cn } from '@/app/lib/utils'
import type { SpanDto } from '@/glue/api/schemas'

import { formatDuration } from './format-duration'
import {
  computeWaterfallLayout,
  visibleRows,
  WaterfallRow
} from './waterfall-layout'

const gridlinePercents = [25, 50, 75]

interface TraceWaterfallProps {
  onSelectSpan: (spanId: string | undefined) => void
  selectedSpanId?: string
  spans: SpanDto[]
}

function barColor(row: WaterfallRow): string {
  if (row.span.status === 'error') {
    return 'bg-red'
  }

  return row.span.serviceName === 'renderer' ? 'bg-blue' : 'bg-green'
}

function Gridlines(): ReactElement {
  return (
    <>
      {gridlinePercents.map((percent) => (
        <div
          className="absolute inset-y-0 border-l border-surface-0/60"
          key={percent}
          style={{ left: `${percent}%` }}
        />
      ))}
    </>
  )
}

export function TraceWaterfall({
  onSelectSpan,
  selectedSpanId,
  spans
}: TraceWaterfallProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const layout = useMemo(() => computeWaterfallLayout(spans), [spans])
  const rows = useMemo(
    () => visibleRows(layout.rows, collapsed),
    [collapsed, layout.rows]
  )

  const toggleCollapsed = (spanId: string) => {
    setCollapsed((current) => {
      const next = new Set(current)

      if (next.has(spanId)) {
        next.delete(spanId)
      } else {
        next.add(spanId)
      }

      return next
    })
  }

  return (
    <div className="flex flex-col text-xs">
      <div className="mb-1 flex items-center gap-2 border-b border-surface-0 px-1 pb-1 text-[10px] text-subtext-0">
        <div className="w-64 shrink-0" />

        <div className="relative h-4 flex-1">
          <span className="absolute left-0">0ms</span>
          <span className="absolute left-1/2 -translate-x-1/2">
            {formatDuration(layout.totalDurationMs / 2)}
          </span>
          <span className="absolute right-0">
            {formatDuration(layout.totalDurationMs)}
          </span>
        </div>

        <span className="w-16 shrink-0" />
      </div>

      {rows.map((row) => (
        <div
          className={cn(
            'flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-surface-0/50',
            row.span.id === selectedSpanId && 'bg-surface-0'
          )}
          key={row.span.id}
          onClick={() =>
            onSelectSpan(
              row.span.id === selectedSpanId ? undefined : row.span.id
            )
          }
        >
          <div
            className="flex w-64 shrink-0 items-center gap-1 overflow-hidden"
            style={{ paddingLeft: `${row.depth * 16}px` }}
          >
            {row.hasChildren ? (
              <button
                aria-label={`${collapsed.has(row.span.id) ? 'Expand' : 'Collapse'} ${row.span.name}`}
                className="shrink-0 rounded-sm text-subtext-0 hover:text-text"
                onClick={(event) => {
                  event.stopPropagation()
                  toggleCollapsed(row.span.id)
                }}
                type="button"
              >
                {collapsed.has(row.span.id) ? (
                  <ChevronRightIcon className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
              </button>
            ) : (
              <span className="size-3 shrink-0" />
            )}

            <span
              className="truncate font-mono"
              title={row.span.name}
            >
              {row.span.name}
            </span>
          </div>

          <div className="relative h-5 flex-1">
            <Gridlines />

            <div
              className={cn('absolute top-1 h-3 rounded-sm', barColor(row))}
              style={{
                left: `${row.leftPercent}%`,
                width: `${row.widthPercent}%`
              }}
            />
          </div>

          <span className="w-16 shrink-0 text-right font-mono text-subtext-0">
            {formatDuration(row.span.durationMs)}
          </span>
        </div>
      ))}
    </div>
  )
}
