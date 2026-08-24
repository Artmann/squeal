import { useVirtualizer } from '@tanstack/react-virtual'
import {
  CSSProperties,
  Fragment,
  memo,
  ReactElement,
  useMemo,
  useRef
} from 'react'

import { maxResultRows } from '@/databases/adapter'
import type { QueryResultDto } from '@/glue/api/schemas'

import { useScrollToMatch } from '../hooks/use-scroll-to-match'
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
  type ResultColumn,
  rowNumberColumnWidth
} from './query-result-columns'
import {
  formatCellValue,
  formatRowAsCsv,
  formatRowAsJson
} from './query-result-format'
import {
  applySearchToRows,
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

  const {
    activeMatch,
    activeRowIndex,
    activeVisibleIndex,
    isFiltering,
    needle,
    toSourceIndex,
    visibleRowCount
  } = applySearchToRows(result.rows.length, search)

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

  useScrollToMatch({
    activeRowIndex,
    activeVisibleIndex,
    isActiveRowRendered: virtualRows.some(
      (item) => toSourceIndex(item.index) === activeRowIndex
    ),
    scrollRef,
    scrollToIndex: virtualizer.scrollToIndex
  })

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

        <QueryResultHead
          columnHasMatch={search?.columnHasMatch}
          columns={columns}
        />

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

            return (
              <QueryResultRow
                activeMatch={activeMatch}
                columnNames={columnNames}
                columns={columns}
                key={rowIndex}
                needle={needle}
                row={result.rows[rowIndex]}
                rowIndex={rowIndex}
              />
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
            <NoMatchesRow
              columnCount={columns.length + 1}
              query={search?.query ?? ''}
              truncated={result.truncated}
            />
          )}
        </tbody>
      </table>
    </div>
  )
})

/**
 * What the grid says when the filter is on and nothing matched.
 *
 * The truncation half is the point: a row absent from the first page is not a
 * row absent from the table, and a bare "no matches" against a capped result
 * answers a question the user did not ask.
 */
function NoMatchesRow({
  columnCount,
  query,
  truncated
}: {
  columnCount: number
  query: string
  truncated: boolean
}): ReactElement {
  return (
    <tr>
      <td
        className="px-[14px] py-4 text-[12.5px] text-text2"
        colSpan={columnCount}
      >
        No matches for “{query}”
        {truncated
          ? ` in the first ${Intl.NumberFormat().format(maxResultRows)} rows.`
          : '.'}
        {truncated && (
          <span className="block pt-[6px] text-text3">
            Only part of the table was returned. Add a WHERE clause to search
            the rest.
          </span>
        )}
      </td>
    </tr>
  )
}

function QueryResultHead({
  columnHasMatch,
  columns
}: {
  columnHasMatch: boolean[] | undefined
  columns: ResultColumn[]
}): ReactElement {
  return (
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
              // Which columns the search landed in, answered at the top of the
              // column rather than only where the rows happen to be scrolled
              // to.
              columnHasMatch?.[columnIndex] === true && 'text-find-strong'
            )}
            key={column.key}
            scope="col"
          >
            {column.name}
          </th>
        ))}
      </tr>
    </thead>
  )
}

function QueryResultRow({
  activeMatch,
  columnNames,
  columns,
  needle,
  row,
  rowIndex
}: {
  activeMatch: ResultRowMatch | undefined
  columnNames: string[]
  columns: ResultColumn[]
  needle: string
  row: Record<string, unknown> | undefined
  rowIndex: number
}): ReactElement {
  return (
    <tr className="group">
      <td className="h-[var(--row-h)] select-none border-b border-border2 px-[10px] text-right font-mono text-[11px] text-text3 group-hover:bg-hover">
        {rowIndex + 1}
      </td>

      {columns.map((column, columnIndex) => (
        <QueryResultCell
          column={column}
          columnNames={columnNames}
          isActive={
            activeMatch !== undefined &&
            activeMatch.rowIndex === rowIndex &&
            activeMatch.columnIndex === columnIndex
          }
          key={`${rowIndex}-${column.key}`}
          needle={needle}
          row={row}
        />
      ))}
    </tr>
  )
}

function QueryResultCell({
  column,
  columnNames,
  isActive,
  needle,
  row
}: {
  column: ResultColumn
  columnNames: string[]
  isActive: boolean
  needle: string
  row: Record<string, unknown> | undefined
}): ReactElement {
  // Known wrong for a result with two identically-named fields: the driver's
  // row is keyed by name, so both columns read the first field's value. The
  // columns are at least distinct elements now; showing the right value needs
  // an array row mode in the adapter.
  const value = row?.[column.name]
  const text = formatCellValue(value)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <td
          className={cn(
            'h-[var(--row-h)] whitespace-nowrap border-b border-border2 px-[14px] font-mono text-[12px] group-hover:bg-hover',
            column.align === 'right' ? 'text-right' : 'text-left',
            value === null && 'text-text3 italic'
          )}
          data-find-active={isActive ? '' : undefined}
        >
          {needle === '' ? (
            text
          ) : (
            <HighlightedCellText
              isActive={isActive}
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
          onSelect={() => navigator.clipboard.writeText(column.name)}
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
                navigator.clipboard.writeText(formatRowAsJson(row ?? {}))
              }
            >
              As JSON
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

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
