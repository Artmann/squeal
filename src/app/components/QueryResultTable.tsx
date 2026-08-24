import { useVirtualizer } from '@tanstack/react-virtual'
import {
  CSSProperties,
  Fragment,
  memo,
  ReactElement,
  useEffect,
  useMemo,
  useRef
} from 'react'

import { maxResultRows } from '@/databases/adapter'
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
import {
  getResultColumns,
  getResultFieldNames,
  rowNumberColumnWidth
} from './query-result-columns'
import {
  formatCellValue,
  formatRowAsCsv,
  formatRowAsJson
} from './query-result-format'
import {
  type ResultRowMatch,
  type ResultSearchView,
  splitCellText
} from './query-result-search'

// The density knob for this grid, and the only definition of `--row-h`:
// nothing else may declare that property. It is published on the scroll
// container below and the rows are painted from it; the virtualizer positions
// them by arithmetic on this number. A second definition makes a density edit
// a choice of which copy to change, and getting it wrong leaves every row
// overlapping or gapped and the scroll height wrong by rows x delta, with no
// type error and nothing at runtime to say so.
//
// Every row is the same height, so this is an exact size rather than an
// estimate and no `measureElement` is wired.
const rowHeight = 34

// The header height, published as `--head-h` under the same rule. The header is
// sticky, so this number is also what keeps a row jumped to by find from
// landing underneath it -- once as the virtualizer's `scrollPaddingStart`, once
// as the container's `scroll-padding-top` for `scrollIntoView`. Three consumers
// of one number is exactly the case `--row-h` exists to prevent.
const headerHeight = 31

// Rows rendered above and below the window, so a fast scroll reaches painted
// rows rather than blank space.
const overscan = 12

// A stable identity for "no search", so the absent-`search` case does not hand
// the virtualizer and the effects a fresh array on every render.
const noMatches: ResultRowMatch[] = []

export const QueryResultTable = memo(function QueryResultTable({
  result,
  search
}: {
  result: QueryResultDto
  search?: ResultSearchView
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)

  const columns = useMemo(
    () =>
      getResultColumns({
        fieldNames: getResultFieldNames(result),
        rows: result.rows
      }),
    [result]
  )

  // Derived once rather than inside the per-cell CSV closure, which would
  // rebuild it for every rendered cell.
  const columnNames = useMemo(
    () => columns.map((column) => column.name),
    [columns]
  )

  const needle = search?.needle ?? ''
  const matches = search?.matches ?? noMatches
  const isFiltering = search?.isFiltering === true && needle !== ''

  const activeMatch =
    search === undefined || search.activeIndex < 0
      ? undefined
      : matches[search.activeIndex]

  // The one place a virtualizer index becomes an index into `result.rows`.
  // While filtering they are different things, and every read of the row, its
  // number and its copy actions has to go through this -- a missed call site
  // shows the wrong row's data with nothing to say so.
  const toSourceIndex = (index: number): number => {
    if (!isFiltering) {
      return index
    }

    const match = matches[index]

    return match === undefined ? index : match.rowIndex
  }

  const visibleRowCount = isFiltering ? matches.length : result.rows.length

  const virtualizer = useVirtualizer({
    count: visibleRowCount,
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan,
    scrollPaddingStart: headerHeight
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

  const activeRowIndex = activeMatch === undefined ? -1 : activeMatch.rowIndex

  // While filtering, the virtualizer counts matches rather than rows, so the
  // ordinal into `matches` already is the position it wants.
  const activeVisibleIndex =
    activeMatch === undefined
      ? -1
      : isFiltering
        ? (search?.activeIndex ?? -1)
        : activeMatch.rowIndex

  useEffect(() => {
    if (activeVisibleIndex < 0) {
      return
    }

    // `auto` leaves the offset alone when the row is already comfortably in
    // view, so stepping between two matches on screen does not jerk the grid.
    virtualizer.scrollToIndex(activeVisibleIndex, { align: 'auto' })
  }, [activeVisibleIndex, virtualizer])

  const isActiveRowRendered = virtualRows.some(
    (item) => toSourceIndex(item.index) === activeRowIndex
  )

  useEffect(() => {
    if (activeRowIndex < 0 || !isActiveRowRendered) {
      return
    }

    // Columns are not virtualized and the table is auto-layout, so the rendered
    // width of a column is not the width that was pinned for it. Asking the
    // browser to reveal the cell is the only reading of the layout that is
    // actually true.
    //
    // Split from the vertical jump on purpose: `scrollToIndex` sets `scrollTop`
    // synchronously, but the virtualizer re-windows on the scroll event that
    // follows, so the target cell is not in the DOM during that pass.
    scrollRef.current
      ?.querySelector('[data-find-active]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeRowIndex, isActiveRowRendered])

  return (
    <div
      className="h-full overflow-auto"
      ref={scrollRef}
      // Cast because React's CSSProperties does not admit custom properties.
      style={
        {
          '--head-h': `${headerHeight}px`,
          '--row-h': `${rowHeight}px`,
          scrollPaddingTop: `${headerHeight}px`
        } as CSSProperties
      }
    >
      <table className="min-w-full border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: `${rowNumberColumnWidth}px` }} />

          {columns.map((column) => (
            <col
              key={column.key}
              style={{ width: `${column.width}px` }}
            />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th className="sticky top-0 z-[5] h-[var(--head-h)] border-b border-border bg-panel2" />

            {columns.map((column, columnIndex) => (
              <th
                className={cn(
                  'sticky top-0 z-[5] h-[var(--head-h)] whitespace-nowrap border-b border-border bg-panel2 px-[14px] text-[12px] font-medium text-text2',
                  // The header sits over its values, so it takes the column's
                  // alignment rather than always hugging the left edge.
                  column.align === 'right' ? 'text-right' : 'text-left',
                  // Which columns the search landed in, answered at the top of
                  // the column rather than only where the rows happen to be
                  // scrolled to.
                  search?.columnHasMatch[columnIndex] === true &&
                    'text-find-strong'
                )}
                key={column.key}
                scope="col"
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td
                colSpan={columns.length + 1}
                style={{ height: `${paddingTop}px` }}
              />
            </tr>
          )}

          {virtualRows.map((virtualRow) => {
            const rowIndex = toSourceIndex(virtualRow.index)
            const row = result.rows[rowIndex]

            return (
              <tr
                className="group"
                key={rowIndex}
              >
                <td className="h-[var(--row-h)] select-none border-b border-border2 px-[10px] text-right font-mono text-[11px] text-text3 group-hover:bg-hover">
                  {rowIndex + 1}
                </td>

                {columns.map((column, columnIndex) => {
                  // Known wrong for a result with two identically-named fields:
                  // the driver's row is keyed by name, so both columns read the
                  // first field's value. The columns are at least distinct
                  // elements now; showing the right value needs an array row
                  // mode in the adapter.
                  const value = row?.[column.name]
                  const text = formatCellValue(value)

                  const isActiveCell =
                    activeMatch !== undefined &&
                    activeMatch.rowIndex === rowIndex &&
                    activeMatch.columnIndex === columnIndex

                  return (
                    <ContextMenu key={`${rowIndex}-${column.key}`}>
                      <ContextMenuTrigger asChild>
                        <td
                          className={cn(
                            'h-[var(--row-h)] whitespace-nowrap border-b border-border2 px-[14px] font-mono text-[12px] group-hover:bg-hover',
                            column.align === 'right'
                              ? 'text-right'
                              : 'text-left',
                            value === null && 'text-text3 italic'
                          )}
                          data-find-active={isActiveCell ? '' : undefined}
                        >
                          {needle === '' ? (
                            text
                          ) : (
                            <HighlightedCellText
                              isActive={isActiveCell}
                              needle={needle}
                              text={text}
                            />
                          )}
                        </td>
                      </ContextMenuTrigger>

                      <ContextMenuContent>
                        <ContextMenuItem
                          className="text-xs"
                          onSelect={() => navigator.clipboard.writeText(text)}
                        >
                          Copy
                        </ContextMenuItem>

                        <ContextMenuItem
                          className="text-xs"
                          onSelect={() =>
                            navigator.clipboard.writeText(column.name)
                          }
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
                                  formatRowAsCsv(row ?? {}, columnNames)
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
                colSpan={columns.length + 1}
                style={{ height: `${paddingBottom}px` }}
              />
            </tr>
          )}

          {isFiltering && visibleRowCount === 0 && (
            <tr>
              <td
                className="px-[14px] py-4 text-[12.5px] text-text2"
                colSpan={columns.length + 1}
              >
                No matches for “{search?.query}”
                {result.truncated
                  ? ` in the first ${Intl.NumberFormat().format(maxResultRows)} rows.`
                  : '.'}
                {/* Silence here would answer a question the search did not ask:
                    a row absent from the first page is not a row absent from
                    the table. */}
                {result.truncated && (
                  <span className="block pt-[6px] text-text3">
                    Only part of the table was returned. Add a WHERE clause to
                    search the rest.
                  </span>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
})

/**
 * Cell text with the matched runs marked. The segments always rejoin into the
 * text they came from, so this cannot change what the cell says.
 */
function HighlightedCellText({
  isActive,
  needle,
  text
}: {
  isActive: boolean
  needle: string
  text: string
}): ReactElement {
  return (
    <>
      {splitCellText(text, needle).map((segment, index) =>
        segment.isMatch ? (
          <mark
            // Chrome's UA sheet paints <mark> yellow-on-black and Tailwind's
            // preflight does not reset it, so the text colour is as load-bearing
            // as the background.
            className={cn(
              'rounded-[2px]',
              isActive
                ? 'bg-find-active text-find-active-text'
                : 'bg-find text-find-text'
            )}
            key={index}
          >
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  )
}
