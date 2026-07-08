import { memo, ReactElement, useEffect, useRef, useState } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './ui/table'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger
} from './ui/context-menu'
import { cn } from '../lib/utils'
import {
  formatCellValue,
  formatRowAsCsv,
  formatRowAsJson
} from './query-result-format'

const pageSize = 100

export const QueryResultTable = memo(function QueryResultTable({
  result
}: {
  result: any
}): ReactElement {
  const [page, setPage] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [page])

  const fieldNames = result.fields.map((field: any) => field.name)
  const totalRows: number = result.rows.length
  const pageCount = Math.ceil(totalRows / pageSize)
  const pageRows = result.rows.slice(page * pageSize, (page + 1) * pageSize)
  const firstRow = page * pageSize + 1
  const lastRow = Math.min((page + 1) * pageSize, totalRows)

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 overflow-auto"
        ref={scrollRef}
      >
        <Table className="w-full text-xs">
          <TableHeader className="sticky top-0 bg-base">
            <TableRow className="bg-base">
              <TableHead className="border-r border-surface-0"></TableHead>
              {fieldNames.map((name: string) => (
                <TableHead
                  className="border-r border-surface-0 last:border-r-0 font-medium"
                  key={name}
                >
                  {name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row: any, rowIndex: number) => (
              <TableRow key={String(page * pageSize + rowIndex)}>
                <TableCell className="border-r border-surface-0 px-2 text-center text-subtext-0">
                  {page * pageSize + rowIndex + 1}
                </TableCell>
                {fieldNames.map((name: string) => {
                  const value = row[name]
                  const isNumber = typeof value === 'number'

                  return (
                    <ContextMenu key={`${rowIndex}-${name}`}>
                      <ContextMenuTrigger asChild>
                        <TableCell
                          className={cn(
                            'border-r border-surface-0 last:border-r-0',
                            isNumber ? 'text-right' : 'text-left',
                            value === null && 'text-subtext-0'
                          )}
                        >
                          {formatCellValue(value)}
                        </TableCell>
                      </ContextMenuTrigger>

                      <ContextMenuContent>
                        <ContextMenuItem
                          className="text-xs"
                          onSelect={() =>
                            navigator.clipboard.writeText(
                              formatCellValue(value)
                            )
                          }
                        >
                          Copy
                        </ContextMenuItem>

                        <ContextMenuItem
                          className="text-xs"
                          onSelect={() => navigator.clipboard.writeText(name)}
                        >
                          Copy Column Name
                        </ContextMenuItem>

                        <ContextMenuSeparator />

                        <ContextMenuSub>
                          <ContextMenuSubTrigger className="text-xs">
                            Copy Row
                          </ContextMenuSubTrigger>

                          <ContextMenuSubContent>
                            <ContextMenuItem
                              className="text-xs"
                              onSelect={() =>
                                navigator.clipboard.writeText(
                                  formatRowAsCsv(row, fieldNames)
                                )
                              }
                            >
                              As CSV
                            </ContextMenuItem>

                            <ContextMenuItem
                              className="text-xs"
                              onSelect={() =>
                                navigator.clipboard.writeText(
                                  formatRowAsJson(row)
                                )
                              }
                            >
                              As JSON
                            </ContextMenuItem>
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t border-surface-0 px-3 py-1.5 text-xs text-subtext-0">
        <span>
          {result.truncated
            ? `Showing first ${Intl.NumberFormat().format(result.rows.length)} rows (result was truncated)`
            : `Rows ${firstRow}–${lastRow} of ${totalRows}`}
        </span>

        {pageCount > 1 && (
          <div className="flex items-center gap-2">
            <button
              className="disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              type="button"
            >
              ← Prev
            </button>
            <span>
              Page {page + 1} of {pageCount}
            </span>
            <button
              className="disabled:opacity-40"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
})
