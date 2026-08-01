import { CircleAlertIcon } from 'lucide-react'
import { ReactElement } from 'react'

import type { TraceSummaryDto } from '@/glue/api/schemas'

import { TimeAgo } from '../TimeAgo'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '../ui/table'
import { formatDuration } from './format-duration'

interface TraceListProps {
  onSelect: (traceId: string) => void
  traces: TraceSummaryDto[]
}

export function TraceList({ onSelect, traces }: TraceListProps): ReactElement {
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-panel">
        <TableRow>
          <TableHead className="w-12 pl-6" />
          <TableHead>Name</TableHead>
          <TableHead>Service</TableHead>
          <TableHead className="text-right">Spans</TableHead>
          <TableHead className="text-right">Duration</TableHead>
          <TableHead className="pr-6 text-right">When</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {traces.map((trace) => (
          <TableRow
            className="cursor-pointer"
            key={trace.traceId}
            onClick={() => onSelect(trace.traceId)}
          >
            <TableCell className="pl-6">
              {trace.hasError ? (
                <CircleAlertIcon
                  aria-label="error"
                  className="size-3.5 text-err"
                  role="status"
                />
              ) : (
                <span
                  aria-label="ok"
                  className="inline-block size-2 rounded-full bg-ok"
                  role="status"
                />
              )}
            </TableCell>
            <TableCell className="font-mono text-xs">
              <div className="flex flex-col gap-0.5">
                <span>{trace.name}</span>

                {trace.errorMessage ? (
                  <span
                    className="max-w-md truncate font-sans text-[11px] text-err"
                    title={trace.errorMessage}
                  >
                    {trace.errorMessage}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-text2">
                {trace.serviceName}
              </span>
            </TableCell>
            <TableCell className="text-right text-text2">
              {trace.spanCount}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              {formatDuration(trace.durationMs)}
            </TableCell>
            <TableCell className="pr-6 text-right text-text2">
              <TimeAgo timestamp={trace.startedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
