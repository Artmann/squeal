import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, ReactElement, useMemo, useRef } from 'react'

import type { QueryResultDto } from '@/glue/api/schemas'

import { cn } from '../lib/utils'
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
import { getColumnWidths, rowNumberColumnWidth } from './query-result-columns'
import {
  formatCellValue,
  formatRowAsCsv,
  formatRowAsJson
} from './query-result-format'

// Mirrors `--row-h`. The virtualizer needs a number, and every row is the same
// height, so this is an exact size rather than an estimate.
const rowHeight = 34

// Rows rendered above and below the window, so a fast scroll does not show a
// gap before the next measure.
const overscan = 12

export const QueryResultTable = memo(function QueryResultTable({
  result
}: {
  result: QueryResultDto
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fall back to the row keys if the adapter returned rows without field
  // metadata, so a fields/rows desync can never blank out the columns.
  const fieldNames = useMemo(
    () =>
      result.fields.length > 0
        ? result.fields.map((field) => field.name)
        : Object.keys(result.rows[0] ?? {}),
    [result.fields, result.rows]
  )

  const columnWidths = useMemo(
    () => getColumnWidths({ fieldNames, rows: result.rows }),
    [fieldNames, result.rows]
  )

  const virtualizer = useVirtualizer({
    count: result.rows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan
  })

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Spacer rows keep the scroll height honest without rendering the rows in
  // between, and keep the windowed rows inside a real <tbody>.
  const paddingTop = virtualRows[0]?.start ?? 0
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0

  return (
    <div
      className="h-full overflow-auto"
      ref={scrollRef}
    >
      <table className="min-w-full border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: `${rowNumberColumnWidth}px` }} />

          {fieldNames.map((name) => (
            <col
              key={name}
              style={{ width: `${columnWidths[name]}px` }}
            />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th className="sticky top-0 z-[5] h-[31px] border-b border-border bg-panel2" />

            {fieldNames.map((name) => (
              <th
                className="sticky top-0 z-[5] h-[31px] whitespace-nowrap border-b border-border bg-panel2 px-[14px] text-left text-[12px] font-medium text-text2"
                key={name}
                scope="col"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={fieldNames.length + 1}
                style={{ height: `${paddingTop}px` }}
              />
            </tr>
          )}

          {virtualRows.map((virtualRow) => {
            const row = result.rows[virtualRow.index]

            return (
              <tr
                className="group"
                key={virtualRow.key}
              >
                <td className="h-[var(--row-h)] select-none border-b border-border2 px-[10px] text-right font-mono text-[11px] text-text3 group-hover:bg-hover">
                  {virtualRow.index + 1}
                </td>

                {fieldNames.map((name) => {
                  const value = row?.[name]

                  return (
                    <ContextMenu key={`${virtualRow.key}-${name}`}>
                      <ContextMenuTrigger asChild>
                        <td
                          className={cn(
                            'h-[var(--row-h)] whitespace-nowrap border-b border-border2 px-[14px] font-mono text-[12px] group-hover:bg-hover',
                            typeof value === 'number'
                              ? 'text-right'
                              : 'text-left',
                            value === null && 'text-text3 italic'
                          )}
                        >
                          {formatCellValue(value)}
                        </td>
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
                                  formatRowAsCsv(row ?? {}, fieldNames)
                                )
                              }
                            >
                              As CSV
                            </ContextMenuItem>

                            <ContextMenuItem
                              className="text-xs"
                              onSelect={() =>
                                navigator.clipboard.writeText(
                                  formatRowAsJson(row ?? {})
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
              </tr>
            )
          })}

          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={fieldNames.length + 1}
                style={{ height: `${paddingBottom}px` }}
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
})
